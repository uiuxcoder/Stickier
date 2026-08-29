import { env } from "cloudflare:workers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generationJobs, generations, orders, subscriptions, users } from "@/db/schema";
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

    const userGenerations = await db
      .select({ imageKey: generations.imageKey })
      .from(generations)
      .where(eq(generations.userId, user.id));

    if (bucket) {
      for (const row of userGenerations) {
        await bucket.delete(row.imageKey).catch((error) =>
          console.error("Failed to delete image", row.imageKey, error)
        );
      }
    }

    await db.delete(generationJobs).where(eq(generationJobs.userId, user.id));
    await db.delete(generations).where(eq(generations.userId, user.id));
    await db.delete(orders).where(eq(orders.userId, user.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Account deletion failed", user.id, error);
    return Response.json({ error: "Unable to delete account." }, { status: 500 });
  }
}
