import { getDb } from "@/db";
import { generationJobs } from "@/db/schema";
import { eq } from "drizzle-orm";

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
      error: generationJobs.error,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  const job = rows[0];
  if (!job) return Response.json({ error: "Job not found." }, { status: 404 });

  return Response.json({
    status: job.status,
    imageKey: job.imageKey,
    previewUrl: job.imageKey
      ? `/api/preview-stickers?key=${encodeURIComponent(job.imageKey)}`
      : null,
    error: job.error,
  });
}
