import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { generationJobs, generations, users } from "@/db/schema";
import { promptFor, type GenerationInput } from "@/lib/prompt";
import { IMAGE_KEY_PATTERN } from "@/lib/constants";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";

export type GenerationJobMessage = {
  jobId: string;
};

type QueueEnv = {
  DB: D1Database;
  STICKER_ASSETS: R2Bucket;
};

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

  const photoKeys: string[] = JSON.parse(job.photoKeys || "[]");
  const photos: File[] = [];
  for (const [index, key] of photoKeys.entries()) {
    const object = await env.STICKER_ASSETS.get(key);
    if (!object) continue;
    const bytes = await object.arrayBuffer();
    const contentType = object.httpMetadata?.contentType || "image/png";
    photos.push(new File([bytes], `reference-${index}.png`, { type: contentType }));
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const body = new FormData();
  body.append("model", model);
  body.append("prompt", promptFor(input));
  body.append("size", "1024x1024");
  body.append("quality", "medium");
  photos.forEach((photo) => body.append("image[]", photo));

  let result: { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  try {
    const response = await fetch(photos.length ? OPENAI_EDITS_URL : OPENAI_IMAGES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    result = await response.json();
    if (!response.ok || (!result.data?.[0]?.b64_json && !result.data?.[0]?.url)) {
      throw new Error(result.error?.message || `OpenAI returned ${response.status}`);
    }
  } catch (error) {
    console.error("OpenAI image generation error", error);
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
