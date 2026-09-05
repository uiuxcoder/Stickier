import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { generationJobs, generations, users } from "@/db/schema";
import { promptFor, type GenerationInput } from "@/lib/prompt";
import { IMAGE_KEY_PATTERN } from "@/lib/constants";
import { CONTENT_POLICY_MESSAGE } from "@/lib/moderation";
import {
  buildOpenAIImageEditBody,
  GENERATION_IMAGE_QUALITY,
  GENERATION_IMAGE_SIZE,
} from "@/lib/openai-image";
import {
  imageFileName,
  inspectJpeg,
  isOpenAIImageType,
  sniffImageType,
  type OpenAIImageType,
} from "@/lib/image-format";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const STYLE_REFERENCE_KEY = "references/sticker-style-v16.webp";
const DEFAULT_IMAGE_MODEL = "gpt-image-2";
// Generate at the economical portrait size; the download pipeline prepares the
// 1200x1800, 300 DPI print asset without another OpenAI request.
// Large sheets can take over two minutes to render.
const GENERATION_TIMEOUT_MS = 480_000;

export type GenerationJobMessage = {
  jobId: string;
};

type ImagesBinding = {
  input(stream: ReadableStream): {
    transform(options: Record<string, unknown>): {
      output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
    };
  };
};

type QueueEnv = {
  DB: D1Database;
  STICKER_ASSETS: R2Bucket;
  IMAGES?: ImagesBinding;
};

// OpenAI's image endpoints reject unsafe requests with these markers rather
// than a distinct HTTP status, so this is the only way to tell a permanent
// content-policy rejection apart from a transient/retryable failure.
function isContentPolicyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /content.?polic|safety system|flagged|not allowed to generate/i.test(message);
}

async function loadStyleReference(env: QueueEnv): Promise<File | null> {
  try {
    const object = await env.STICKER_ASSETS.get(STYLE_REFERENCE_KEY);
    if (!object) throw new Error("Style reference is missing from R2");
    const bytes = await object.arrayBuffer();
    const contentType = sniffImageType(bytes);
    if (!isOpenAIImageType(contentType)) throw new Error("Asset is not an OpenAI-compatible image");
    return new File([bytes], imageFileName("style-reference-final", contentType), { type: contentType });
  } catch (error) {
    console.error("Failed to load the bundled style reference", error);
    return null;
  }
}

/**
 * Re-encode a reference photo that OpenAI would reject. Apple's HDR JPEGs embed
 * a gain map through an APP2 "MPF" segment, and the edits endpoint fails the
 * whole request with "invalid image file" when it sees one. The browser already
 * strips these during upload; this is the backstop for anything that did not go
 * through that path.
 */
async function sanitizeReferencePhoto(
  env: QueueEnv,
  bytes: ArrayBuffer,
  contentType: OpenAIImageType
): Promise<{ bytes: ArrayBuffer; contentType: OpenAIImageType }> {
  const advisory = contentType === "image/jpeg" ? inspectJpeg(bytes) : null;
  if (!advisory?.multiPicture && (advisory?.orientation ?? 1) <= 1) return { bytes, contentType };

  if (!env.IMAGES) {
    console.error("Reference photo needs re-encoding but the IMAGES binding is unavailable.");
    return { bytes, contentType };
  }

  try {
    const result = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({})
      .output({ format: "image/jpeg", quality: 95 });
    return { bytes: await result.response().arrayBuffer(), contentType: "image/jpeg" };
  } catch (error) {
    console.error("Failed to re-encode reference photo", error);
    return { bytes, contentType };
  }
}

function getDb(env: QueueEnv) {
  return drizzle(env.DB, { schema });
}

async function refundReservedQuota(env: QueueEnv, job: typeof generationJobs.$inferSelect) {
  if (!job.userId || job.reservedQuota <= 0) return;
  await getDb(env)
    .update(users)
    .set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + ${job.reservedQuota}` })
    .where(eq(users.id, job.userId))
    .catch((error) => console.error("Failed to refund quota", job.id, error));
}

async function markFailed(
  env: QueueEnv,
  job: typeof generationJobs.$inferSelect,
  message: string
) {
  await getDb(env)
    .update(generationJobs)
    .set({ status: "failed", error: message, updatedAt: Date.now() })
    .where(eq(generationJobs.id, job.id));
  await refundReservedQuota(env, job);
}

/**
 * Process a single sticker-generation job from the queue. Runs outside the
 * request path, so a slow OpenAI call never holds a user connection open and a
 * transient failure can be retried by the queue rather than dropped.
 */
export async function processGenerationJob(env: QueueEnv, message: GenerationJobMessage) {
  const db = getDb(env);
  const rows = await db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.id, message.jobId))
    .limit(1);
  const job = rows[0];
  if (!job) return;
  if (job.status === "succeeded" || job.status === "failed") return;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await markFailed(env, job, "OpenAI is not configured.");
    return;
  }

  await db
    .update(generationJobs)
    .set({ status: "processing", updatedAt: Date.now() })
    .where(eq(generationJobs.id, job.id));

  let input: GenerationInput;
  try {
    input = JSON.parse(job.inputJson) as GenerationInput;
  } catch {
    await markFailed(env, job, "Stored job input was unreadable.");
    return;
  }

  const identityKeys: string[] = JSON.parse(job.photoKeys || "[]");
  const referenceKeys: string[] = Array.isArray(input.referencePhotoKeys) ? input.referencePhotoKeys : [];

  async function loadFiles(keys: string[], inline: string[] = []): Promise<File[]> {
    const files: File[] = [];
    for (const [index, key] of keys.entries()) {
      const object = await env.STICKER_ASSETS.get(key);
      if (!object) continue;
      const stored = await object.arrayBuffer();
      const storedType = sniffImageType(stored);
      if (!isOpenAIImageType(storedType)) {
        console.error("Skipping image with unsupported format", key);
        continue;
      }
      const { bytes, contentType } = await sanitizeReferencePhoto(env, stored, storedType);
      files.push(new File([bytes], imageFileName(`image-${index}`, contentType), { type: contentType }));
    }
    for (const [index, dataUrl] of inline.entries()) {
      const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!match) continue;
      const contentType = match[1] as OpenAIImageType;
      if (!isOpenAIImageType(contentType)) continue;
      const bytes = Uint8Array.from(Buffer.from(match[2], "base64")).buffer;
      files.push(new File([bytes], imageFileName(`inline-${index}`, contentType), { type: contentType }));
    }
    return files;
  }

  const identityPhotos = await loadFiles(identityKeys, input.photos ?? []);
  const referencePhotos = await loadFiles(referenceKeys, input.referencePhotos ?? []);

  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  const basePrompt = promptFor(input, false);
  let result: { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  try {
    let response: Response;
    if (identityPhotos.length) {
      const body = buildOpenAIImageEditBody({
        model,
        prompt: basePrompt,
        quality: GENERATION_IMAGE_QUALITY,
        size: GENERATION_IMAGE_SIZE,
        background: "opaque",
        photos: [...identityPhotos, ...referencePhotos],
      });

      response = await fetch(OPENAI_EDITS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
    } else {
      const jsonBody = JSON.stringify({
        model,
        prompt: basePrompt,
        size: GENERATION_IMAGE_SIZE,
        quality: GENERATION_IMAGE_QUALITY,
        background: "opaque",
        output_format: "png",
      });
      response = await fetch(OPENAI_IMAGES_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: jsonBody,
        signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS),
      });
    }
    result = await response.json();
    if (!response.ok || (!result.data?.[0]?.b64_json && !result.data?.[0]?.url)) {
      throw new Error(result.error?.message || `OpenAI returned ${response.status}`);
    }
  } catch (error) {
    console.error("OpenAI image generation error", error);
    if (isContentPolicyViolation(error)) {
      await markFailed(env, job, CONTENT_POLICY_MESSAGE);
      return;
    }
    // Rethrow so the queue retries transient failures; the consumer marks the
    // job failed only after retries are exhausted.
    throw error;
  }

  const image = result.data![0];
  const imageBytes = image.url
    ? await (await fetch(image.url, { signal: AbortSignal.timeout(30_000) })).arrayBuffer()
    : Uint8Array.from(Buffer.from(image.b64_json!, "base64"));

  const imageKey = `stickers/${crypto.randomUUID()}.png`;
  if (!IMAGE_KEY_PATTERN.test(imageKey)) {
    await markFailed(env, job, "Generated an invalid image key.");
    return;
  }

  // Print assets are built lazily by the download route and the Stripe webhook.
  // Building them here costs more CPU than a queue invocation is allowed and
  // kills the job before it can be marked succeeded.
  await env.STICKER_ASSETS.put(imageKey, imageBytes, {
    httpMetadata: { contentType: "image/png" },
  });

  const now = Date.now();
  await db.insert(generations).values({
    imageKey,
    userId: job.userId,
    email: job.email,
    createdAt: now,
  });
  await db
    .update(generationJobs)
    .set({ status: "succeeded", imageKey, updatedAt: now })
    .where(eq(generationJobs.id, job.id));
}
