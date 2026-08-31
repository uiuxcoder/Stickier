import { env } from "cloudflare:workers";
import { buildClearSessionCookie, getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generationJobs, generations, membershipDrops, orders, subscriptions, users } from "@/db/schema";
import { UPLOAD_KEY_PATTERN } from "@/lib/constants";
import { downloadArchiveKey, legacyDownloadArchiveKey, printSheetKey } from "@/lib/sticker-archive";
import { getStripe } from "@/lib/stripe";
import { and, eq, inArray } from "drizzle-orm";

/**
 * Delete the signed-in user's account and stored data: profile, subscription
 * records, order history, generation jobs, and any generated images held in
 * R2. Active Stripe subscriptions are canceled first so a deleted account is
 * never billed again. This backs the right-to-erasure commitment in the
 * privacy policy.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign in to delete your account." }, { status: 401 });

  const db = getDb();
  const bucket = env.STICKER_ASSETS;

  try {
    const activeSubscriptions = await db
      .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])));

    if (activeSubscriptions.length > 0 && process.env.STRIPE_SECRET_KEY) {
      const stripe = getStripe();
      for (const row of activeSubscriptions) {
        try {
          await stripe.subscriptions.cancel(row.stripeSubscriptionId);
        } catch (error) {
          // A stale local record pointing at a subscription Stripe no longer
          // has is already canceled in effect; anything else must abort so a
          // deleted account is never left billing.
          if ((error as { statusCode?: number })?.statusCode !== 404) throw error;
        }
      }
    }

    const [userGenerations, userJobs] = await Promise.all([
      db.select({ imageKey: generations.imageKey }).from(generations).where(eq(generations.userId, user.id)),
      db.select({ photoKeys: generationJobs.photoKeys }).from(generationJobs).where(eq(generationJobs.userId, user.id)),
    ]);

    if (bucket) {
      for (const row of userGenerations) {
        await bucket.delete([
          row.imageKey,
          downloadArchiveKey(row.imageKey),
          legacyDownloadArchiveKey(row.imageKey),
          printSheetKey(row.imageKey),
        ]).catch((error) =>
          console.error("Failed to delete image", row.imageKey, error)
        );
      }
      const uploadKeys = userJobs.flatMap((row) => {
        try {
          const keys = JSON.parse(row.photoKeys) as unknown;
          return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string" && UPLOAD_KEY_PATTERN.test(key)) : [];
        } catch {
          return [];
        }
      });
      if (uploadKeys.length > 0) {
        await bucket.delete(uploadKeys).catch((error) => console.error("Failed to delete uploaded photos", error));
      }
    }

    await db.delete(generationJobs).where(eq(generationJobs.userId, user.id));
    await db.delete(membershipDrops).where(eq(membershipDrops.userId, user.id));
    await db.delete(generations).where(eq(generations.userId, user.id));
    await db.delete(orders).where(eq(orders.userId, user.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));

    return Response.json({ deleted: true }, { headers: { "Set-Cookie": buildClearSessionCookie(request) } });
  } catch (error) {
    console.error("Account deletion failed", user.id, error);
    return Response.json({ error: "Unable to delete account." }, { status: 500 });
  }
}
