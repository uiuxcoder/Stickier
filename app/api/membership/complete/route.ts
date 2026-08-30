import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { generations, orders, subscriptions, users } from "@/db/schema";
import { mintSessionCookie } from "@/lib/auth";
import { MONTHLY_REGENERATIONS } from "@/lib/constants";
import { checkoutEmail, customerId, getStripe, isPaidCheckout } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sessionId = requestUrl.searchParams.get("session_id");
  const failureUrl = new URL("/membership?checkout=invalid", requestUrl.origin);

  if (!sessionId || !process.env.STRIPE_SECRET_KEY) {
    return Response.redirect(failureUrl, 303);
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const email = checkoutEmail(session);
    if (session.mode !== "subscription" || !isPaidCheckout(session) || !email) {
      return Response.redirect(failureUrl, 303);
    }

    const db = getDb();
    const metadataUserId = session.metadata?.userId;
    const existingByEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const userId = existingByEmail[0]?.id || metadataUserId || crypto.randomUUID();
    const stripeCustomerId = customerId(session.customer);
    const now = Date.now();

    await db
      .insert(users)
      .values({
        id: userId,
        email,
        fullName: session.customer_details?.name || null,
        emailVerifiedAt: now,
        stripeCustomerId,
        regenerationsRemaining: MONTHLY_REGENERATIONS,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          stripeCustomerId,
          regenerationsRemaining: MONTHLY_REGENERATIONS,
          emailVerifiedAt: now,
          ...(session.customer_details?.name ? { fullName: session.customer_details.name } : {}),
        },
      });

    const imageKey = session.metadata?.imageKey;
    if (isImageKey(imageKey)) {
      await db
        .update(generations)
        .set({ userId, email, purchasedAt: now })
        .where(eq(generations.imageKey, imageKey));

      await db
        .insert(orders)
        .values({
          id: crypto.randomUUID(),
          userId,
          email,
          stripeSessionId: session.id,
          kind: "subscription",
          subject: session.metadata?.subject || "Your",
          imageKey,
          amount: session.amount_total || 0,
          createdAt: now,
        })
        .onConflictDoNothing({ target: orders.stripeSessionId });
    }

    const stripeSubscriptionId =
      typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (stripeSubscriptionId) {
      await db
        .insert(subscriptions)
        .values({ stripeSubscriptionId, userId, email, status: "active", createdAt: now })
        .onConflictDoUpdate({
          target: subscriptions.stripeSubscriptionId,
          set: { userId, email, status: "active" },
        });
    }

    const { setCookie } = await mintSessionCookie(
      { id: userId, email, fullName: session.customer_details?.name },
      request,
    );
    const welcomeUrl = new URL("/membership/welcome", requestUrl.origin);
    welcomeUrl.searchParams.set("session_id", session.id);
    return new Response(null, {
      status: 303,
      headers: { Location: welcomeUrl.toString(), "Set-Cookie": setCookie, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Membership completion failed", error);
    return Response.redirect(failureUrl, 303);
  }
}
