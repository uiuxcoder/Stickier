import { getDb } from "@/db";
import { orders } from "@/db/schema";
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
      // The webhook may not have landed yet; the client polls this endpoint.
      return Response.json({ paid: false, pending: true });
    }

    return Response.json({
      paid: true,
      email: order[0].email,
      subject: order[0].subject,
      imageKey: order[0].imageKey,
      downloadUrl: `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`,
    });
  } catch (error) {
    console.error("Checkout status lookup failed", error);
    return Response.json({ paid: false }, { status: 500 });
  }
}
