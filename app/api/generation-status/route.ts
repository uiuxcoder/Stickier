import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { generationJobs } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";

// Must stay above the worker's own OpenAI timeout. A print-resolution sheet
// takes a couple of minutes, and requeueing one that is still rendering would
// pay for the same sheet twice.
const STALE_PROCESSING_MS = 10 * 60 * 1000;

/**
 * Poll the status of a queued sticker-generation job. The client calls this on
 * an interval after submitting a generation request, instead of holding a
 * connection open for the full OpenAI call.
 */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId is required." }, { status: 400 });

  const rows = await getDb()
    .select({
      status: generationJobs.status,
      imageKey: generationJobs.imageKey,
      reservedQuota: generationJobs.reservedQuota,
      error: generationJobs.error,
      updatedAt: generationJobs.updatedAt,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

  if (job.status === "processing" && job.updatedAt < Date.now() - STALE_PROCESSING_MS) {
    const now = Date.now();
    const claimed = await getDb()
      .update(generationJobs)
      .set({ status: "queued", updatedAt: now })
      .where(and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "processing"),
        lt(generationJobs.updatedAt, now - STALE_PROCESSING_MS)
      ))
      .returning({ id: generationJobs.id });
    if (claimed[0]) {
      try {
        await env.GENERATION_QUEUE.send({ jobId });
      } catch (error) {
        console.error("Failed to requeue stale generation", jobId, error);
        await getDb()
          .update(generationJobs)
          .set({ status: "failed", error: "Generation could not be restarted.", updatedAt: Date.now() })
          .where(eq(generationJobs.id, jobId));
        return Response.json({ status: "failed", imageKey: null, previewUrl: null, error: "Generation could not be restarted." });
      }
      return Response.json({ status: "queued", imageKey: null, previewUrl: null, error: null });
    }
  }

  return Response.json({
    status: job.status,
    imageKey: job.imageKey,
    saved: Boolean(job.reservedQuota),
    previewUrl: job.imageKey
      ? `/api/preview-stickers?key=${encodeURIComponent(job.imageKey)}`
      : null,
    error: job.error,
  });
}
