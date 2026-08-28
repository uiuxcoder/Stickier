import Stripe from "stripe";
import { Resend } from "resend";
import { getDb } from "@/db";
import { orders, subscriptions, users } from "@/db/schema";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !secret) {
    return Response.json({ error: "Webhook is not configured." }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    return Response.json({ error: "Payment email is not configured." }, { status: 500 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      secret,
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const imageKey = session.metadata?.imageKey;
      const email = session.customer_details?.email || session.customer_email;
      if (email && imageKey) {
        try {
          const db = getDb();
          await db.insert(users).values({ email, stripeCustomerId: typeof session.customer === "string" ? session.customer : null, regenerationsRemaining: session.mode === "subscription" ? 20 : 0 }).onConflictDoUpdate({ target: users.email, set: { stripeCustomerId: typeof session.customer === "string" ? session.customer : null, regenerationsRemaining: session.mode === "subscription" ? 20 : undefined } });
          await db.insert(orders).values({ id: crypto.randomUUID(), email, stripeSessionId: session.id, kind: session.mode === "subscription" ? "subscription" : "one-time", subject: session.metadata?.subject || "Your", imageKey, amount: session.amount_total || 0 }).onConflictDoNothing({ target: orders.stripeSessionId });
          if (session.mode === "subscription" && typeof session.subscription === "string") {
            await db.insert(subscriptions).values({ stripeSubscriptionId: session.subscription, email, status: "active" }).onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: { status: "active", email } });
          }
        } catch (error) {
          console.error("Stripe order persistence failed", error);
        }
      }
      if (session.payment_status === "paid" && imageKey && email) {
        const origin = new URL(request.url).origin;
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL,
          to: email,
          subject: "Your Stickier download is ready",
          html: `<p>Your personalized sticker sheet is ready.</p><p><a href="${origin}/api/download-stickers?session_id=${encodeURIComponent(session.id)}">Download your stickers</a></p><p>This download link expires in 7 days.</p>`,
        });
      }
      console.log("Stripe checkout completed", session.id);
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      const subscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
      const email = invoice.customer_email;
      if (subscriptionId && email) {
        await getDb().update(users).set({ regenerationsRemaining: 20 }).where(eq(users.email, email));
        await getDb().update(subscriptions).set({ status: "active" }).where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
      }
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const subscriptionId = subscription.id;
      const status = subscription.status;
      await getDb().update(subscriptions).set({ status, currentPeriodEnd: subscription.current_period_end }).where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook verification failed", error);
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
  }
}