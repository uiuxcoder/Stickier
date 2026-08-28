import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { getStripe, checkoutEmail, isPaidCheckout } from "@/lib/stripe";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) {
    return Response.json({ paid: false }, { status: 400 });
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (!isPaidCheckout(session)) return Response.json({ paid: false });

    const order = await getDb().select().from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1);
    return Response.json({
      paid: true,
      email: checkoutEmail(session),
      subject: session.metadata?.subject || order[0]?.subject || "Your",
      imageKey: order[0]?.imageKey || session.metadata?.imageKey || null,
      downloadUrl: `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`,
    });
  } catch (error) {
    console.error("Checkout status lookup failed", error);
    return Response.json({ paid: false }, { status: 404 });
  }
}
