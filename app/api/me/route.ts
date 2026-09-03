import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { and, eq, inArray } from "drizzle-orm";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ user: null });
  const db = getDb();
  const [activeMembership, profile] = await Promise.all([
    db
      .select({ id: subscriptions.stripeSubscriptionId })
      .from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")))
      .limit(1),
    db.select({ stripeCustomerId: users.stripeCustomerId }).from(users).where(eq(users.id, user.id)).limit(1),
  ]);
  let isActiveMember = Boolean(activeMembership[0]);
  const stripeCustomerId = profile[0]?.stripeCustomerId;
  if (isActiveMember && stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
    try {
      const liveSubscriptions = await getStripe().subscriptions.list({ customer: stripeCustomerId, status: "active", limit: 1 });
      isActiveMember = liveSubscriptions.data.length > 0;
    } catch (error) {
      console.error("Active membership verification failed", error);
    }
  }
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    isActiveMember,
  });
}
