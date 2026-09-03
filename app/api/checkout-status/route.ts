import { getDb } from "@/db";
import { generations, orders } from "@/db/schema";
import { ONE_TIME_AMOUNT_CENTS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { eq } from "drizzle-orm";

/**
 * Confirm a completed checkout. Reads from the local orders table (populated by
 * the Stripe webhook) rather than calling the Stripe API on every request, so
 * the read path stays at the edge and does not consume Stripe's rate budget.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) {
    return Response.json({ paid: false }, { status: 400 });
  }

  try {
    const order = await getDb()
      .select()
      .from(orders)
      .where(eq(orders.stripeSessionId, sessionId))
      .limit(1);

    if (!order[0]) {
      const hostname = new URL(request.url).hostname;
      const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "terminal.local";
      const isLocalDev = process.env.NODE_ENV !== "production" || isLocalHost;

      // Local fallback: if webhook forwarding is not running, confirm payment
      // directly with Stripe once and materialize the local order row.
      if (isLocalDev && process.env.STRIPE_SECRET_KEY) {
        const session = await getStripe().checkout.sessions.retrieve(sessionId);
        const paid = session.payment_status === "paid";
        const imageKey = session.metadata?.imageKey;
        const email = session.customer_details?.email || session.customer_email || session.metadata?.email || null;
        const amount = session.amount_total ?? ONE_TIME_AMOUNT_CENTS;
        const plan = session.metadata?.plan === "physical" ? "physical" : "digital";

        if (paid && email && isImageKey(imageKey)) {
          const now = Date.now();
          await getDb()
            .insert(orders)
            .values({
              id: crypto.randomUUID(),
              userId: session.metadata?.userId || null,
              email,
              stripeSessionId: session.id,
              kind: plan === "physical" ? "one-time" : "one-time",
              subject: session.metadata?.subject || "Your",
              imageKey,
              amount,
              createdAt: now,
            })
            .onConflictDoNothing({ target: orders.stripeSessionId });

          await getDb().update(generations).set({ purchasedAt: now, email, ...(session.metadata?.userId ? { userId: session.metadata.userId } : {}) }).where(eq(generations.imageKey, imageKey));

          return Response.json({
            paid: true,
            email,
            subject: session.metadata?.subject || "Your",
            imageKey,
            plan,
            downloadUrl: `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`,
          });
        }
      }

      // The webhook may not have landed yet; the client polls this endpoint.
      return Response.json({ paid: false, pending: true });
    }

    return Response.json({
      paid: true,
      email: order[0].email,
      subject: order[0].subject,
      imageKey: order[0].imageKey,
      plan: order[0].amount >= 999 ? "physical" : "digital",
      downloadUrl: `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`,
    });
  } catch (error) {
    console.error("Checkout status lookup failed", error);
    return Response.json({ paid: false }, { status: 500 });
  }
}
