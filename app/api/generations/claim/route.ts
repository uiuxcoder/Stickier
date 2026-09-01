import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { generationJobs, generations, subscriptions } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign in to save this creation." }, { status: 401 });

  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
    return Response.json({ error: "That creation could not be restored." }, { status: 400 });
  }

  const db = getDb();
  const [membership, job] = await Promise.all([
    db.select({ id: subscriptions.stripeSubscriptionId })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
      .limit(1),
    db.select({ userId: generationJobs.userId, imageKey: generationJobs.imageKey, status: generationJobs.status })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .limit(1),
  ]);

  if (!membership[0]) return Response.json({ error: "An active Sticker Club membership is required." }, { status: 403 });
  if (!job[0] || job[0].status !== "succeeded" || !job[0].imageKey) {
    return Response.json({ error: "That creation is not ready to save yet." }, { status: 409 });
  }
  if (job[0].userId && job[0].userId !== user.id) {
    return Response.json({ error: "That creation belongs to another account." }, { status: 403 });
  }

  await db.batch([
    db.update(generationJobs)
      .set({ userId: user.id, email: user.email, updatedAt: Date.now() })
      .where(eq(generationJobs.id, jobId)),
    db.update(generations)
      .set({ userId: user.id, email: user.email })
      .where(and(
        eq(generations.imageKey, job[0].imageKey),
        job[0].userId ? eq(generations.userId, job[0].userId) : isNull(generations.userId)
      )),
  ]);

  return Response.json({ imageKey: job[0].imageKey });
}