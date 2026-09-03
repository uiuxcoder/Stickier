import { env } from "cloudflare:workers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generationJobs, subscriptions, users } from "@/db/schema";
import { ANON_DAILY_PREVIEWS, GENERATE_HOURLY_CAP } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { dataUrlToFile, generationRequestSchema } from "@/lib/validation";
import { extensionForImageType } from "@/lib/image-format";
import { isLocalHostname } from "@/lib/turnstile";
import { CONTENT_POLICY_MESSAGE, moderateText } from "@/lib/moderation";
import { processGenerationJob } from "@/lib/generation-worker";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

const ACTIVE_STATUSES = ["active", "trialing"] as const;

/**
 * Submit a sticker-generation request. This validates the request, enforces
 * abuse controls, reserves quota, stores any inline photos, and enqueues a job.
 * The actual OpenAI call runs in the queue consumer, so this route returns
 * immediately with a jobId the client polls via /api/generation-status.
 */
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "OpenAI is not configured." }, { status: 500 });
  }
  const bucket = env.STICKER_ASSETS;
  if (!bucket) return Response.json({ error: "Image storage is not configured." }, { status: 500 });
  const queue = env.GENERATION_QUEUE;
  if (!queue) return Response.json({ error: "Generation queue is not configured." }, { status: 500 });

  const ipHash = await hashIp(request);
  const hourly = await consumeRateLimit(rateLimiters().generate, `generate:${ipHash}`, GENERATE_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  const parsed = generationRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Please check your photos and details and try again." }, { status: 400 });
  }
  const input = parsed.data;

  const host = new URL(request.url).hostname;
  const isLocalDev = isLocalHostname(host) || process.env.LOCAL_DEV === "1";

  const user = await getSessionUser(request);
  const db = getDb();

  // Reserve quota for signed-in subscribers before doing any work.
  let reservedUserId: string | null = null;
  let canKeepGeneration = false;
  if (user) {
    const activeSubscription = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, [...ACTIVE_STATUSES])))
      .limit(1);

    if (activeSubscription[0]) {
      canKeepGeneration = true;
      const updated = await db
        .update(users)
        .set({ regenerationsRemaining: sql`${users.regenerationsRemaining} - 1` })
        .where(and(eq(users.id, user.id), gt(users.regenerationsRemaining, 0)))
        .returning({ remaining: users.regenerationsRemaining });
      if (!updated[0]) {
        return Response.json({ error: "Your monthly regenerations are used up." }, { status: 403 });
      }
      reservedUserId = user.id;
    }
  }

  // Anonymous users get a small number of free previews per day.
  if (!reservedUserId) {
    const daily = await consumeRateLimit(rateLimiters().generate, `preview:${ipHash}`, ANON_DAILY_PREVIEWS, 24 * 60 * 60 * 1000);
    if (!daily.ok) {
      return Response.json(
        { error: "Free preview limit reached. Subscribe for 20 regenerations each month." },
        { status: 429 }
      );
    }
  }

  // Content moderation on the free-text fields before anything is generated.
  const textToModerate = [input.subject, input.specialRequest, input.companionName]
    .filter(Boolean)
    .join("\n");
  const moderation = await moderateText(textToModerate);
  const moderationBlocked =
    !moderation.allowed &&
    !(isLocalDev && moderation.reason === "moderation-unavailable");
  if (moderationBlocked) {
    if (reservedUserId) {
      await db.update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.id, reservedUserId));
    }
    return Response.json({ error: CONTENT_POLICY_MESSAGE }, { status: 400 });
  }

  const jobId = crypto.randomUUID();
  const uploadedKeys: string[] = [];
  let jobInserted = false;

  try {
    // Persist photos: inline data URLs are uploaded to R2 now; pre-uploaded keys
    // are passed through. The job stores only R2 keys, never raw bytes.
    const photoKeys: string[] = [...input.photoKeys];
    for (const [index, dataUrl] of input.photos.entries()) {
      const file = dataUrlToFile(dataUrl, index);
      if (!file) continue;
      const key = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}.${extensionForImageType(file.type)}`;
      await bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });
      uploadedKeys.push(key);
      photoKeys.push(key);
    }

    const now = Date.now();
    await db.insert(generationJobs).values({
      id: jobId,
      userId: canKeepGeneration ? user?.id ?? null : null,
      email: canKeepGeneration ? user?.email ?? null : null,
      status: "queued",
      inputJson: JSON.stringify(input),
      photoKeys: JSON.stringify(photoKeys),
      reservedQuota: reservedUserId ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    jobInserted = true;

    if (isLocalDev) {
      // Local wrangler queue delivery is not always reliable during hot reload,
      // so run jobs inline in localhost to keep development flow usable.
      try {
        await processGenerationJob({ DB: env.DB, STICKER_ASSETS: bucket, IMAGES: env.IMAGES }, { jobId });
      } catch (error) {
        console.error("Local generation job failed", error);
        await db
          .update(generationJobs)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : "Generation failed.",
            reservedQuota: 0,
            updatedAt: Date.now(),
          })
          .where(eq(generationJobs.id, jobId));
        if (reservedUserId) {
          await db.update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.id, reservedUserId));
        }
      }
    } else {
      await queue.send({ jobId });
    }
  } catch (error) {
    console.error("Generation submission failed", error);
    if (jobInserted) await db.delete(generationJobs).where(eq(generationJobs.id, jobId)).catch(() => undefined);
    if (uploadedKeys.length > 0) await bucket.delete(uploadedKeys).catch(() => undefined);
    if (reservedUserId) {
      await db.update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.id, reservedUserId));
    }
    return Response.json({ error: "Unable to start generation. Please try again." }, { status: 500 });
  }

  return Response.json({ jobId, status: "queued" });
}
