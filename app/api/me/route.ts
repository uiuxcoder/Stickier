import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ user: null });
  const activeMembership = await getDb()
    .select({ id: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")))
    .limit(1);
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.displayName },
    isActiveMember: Boolean(activeMembership[0]),
  });
}
