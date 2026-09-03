import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { and, eq, gt } from "drizzle-orm";

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: "Sign in to resume membership." }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  try {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Find canceled subscription that's still valid
    const canceledSub = await db
      .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId, currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          eq(subscriptions.status, "canceled"),
          gt(subscriptions.currentPeriodEnd, now),
        ),
      )
      .limit(1);

    if (!canceledSub[0]) {
      return Response.json({ error: "No membership to resume." }, { status: 404 });
    }

    // Resume the subscription in Stripe by setting cancel_at_period_end to false
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.update(canceledSub[0].stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    // Update our database to reflect the active status
    // (The webhook will also update this when Stripe sends the subscription.updated event)
    await db
      .update(subscriptions)
      .set({ status: "active" })
      .where(eq(subscriptions.stripeSubscriptionId, canceledSub[0].stripeSubscriptionId));

    return Response.json({ success: true, message: "Membership resumed!" });
  } catch (error) {
    console.error("Resume membership error", error);
    return Response.json({ error: "Unable to resume membership." }, { status: 500 });
  }
}
