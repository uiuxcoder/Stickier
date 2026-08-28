import Stripe from "stripe";
import { Resend } from "resend";
import { getDb } from "@/db";
import { generations, orders, stripeEvents, subscriptions, users } from "@/db/schema";
import { MONTHLY_REGENERATIONS } from "@/lib/constants";
import {
  checkoutEmail,
  customerId,
  getStripe,
  isPaidCheckout,
  periodEndFromSubscription,
  subscriptionIdFromInvoice,
} from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { and, eq, inArray, sql } from "drizzle-orm";

async function recordEvent(event: Stripe.Event) {
  const inserted = await getDb()
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  return inserted.length > 0;
}

async function sendDownloadEmail(session: Stripe.Checkout.Session, email: string, origin: string) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error("Resend is not configured.");
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: email,
    subject: "Your Stickier download is ready",
    html: `<p>Your personalized sticker sheet is ready.</p><p><a href="${origin}/api/download-stickers?session_id=${encodeURIComponent(session.id)}">Download your stickers</a></p><p>This download link expires in 7 days.</p>`,
  });
  if (result.error) throw new Error(result.error.message);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, origin: string) {
  if (!isPaidCheckout(session)) return;
  const imageKey = session.metadata?.imageKey;
  const email = checkoutEmail(session);
  if (!email || !isImageKey(imageKey)) return;

  const db = getDb();
  const stripeCustomerId = customerId(session.customer);
  const isSubscription = session.mode === "subscription";

  await db
    .insert(users)
    .values({
      email,
      stripeCustomerId,
      regenerationsRemaining: isSubscription ? MONTHLY_REGENERATIONS : 0,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        stripeCustomerId,
        regenerationsRemaining: isSubscription ? MONTHLY_REGENERATIONS : sql`${users.regenerationsRemaining}`,
      },
    });

  await db
    .insert(orders)
    .values({
      id: crypto.randomUUID(),
      email,
      stripeSessionId: session.id,
      kind: isSubscription ? "subscription" : "one-time",
      subject: session.metadata?.subject || "Your",
      imageKey,
      amount: session.amount_total || 0,
    })
    .onConflictDoNothing({ target: orders.stripeSessionId });

  await db.update(generations).set({ purchasedAt: Date.now(), email }).where(eq(generations.imageKey, imageKey));

  if (isSubscription && typeof session.subscription === "string") {
    await db
      .insert(subscriptions)
      .values({ stripeSubscriptionId: session.subscription, email, status: "active" })
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: { status: "active", email },
      });
  }

  const existing = await db
    .select({ emailSentAt: orders.emailSentAt })
    .from(orders)
    .where(eq(orders.stripeSessionId, session.id))
    .limit(1);
  if (!existing[0]?.emailSentAt) {
    await sendDownloadEmail(session, email, origin);
    await db.update(orders).set({ emailSentAt: new Date().toISOString() }).where(eq(orders.stripeSessionId, session.id));
  }
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  const email = invoice.customer_email || invoice.metadata?.email || null;
  if (!subscriptionId) return;
  const db = getDb();
  if (email) {
    await db.update(users).set({ regenerationsRemaining: MONTHLY_REGENERATIONS }).where(eq(users.email, email));
    await db.update(subscriptions).set({ status: "active", email }).where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
    return;
  }
  await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const status = subscription.status;
  const periodEnd = periodEndFromSubscription(subscription);
  const email = subscription.metadata?.email;
  const db = getDb();

  await db
    .insert(subscriptions)
    .values({
      stripeSubscriptionId: subscription.id,
      email: email || "unknown",
      status,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: { status, currentPeriodEnd: periodEnd, ...(email ? { email } : {}) },
    });

  const inactive = status === "canceled" || status === "unpaid" || status === "incomplete_expired";
  if (!inactive) return;

  const rows = await db
    .select({ email: subscriptions.email })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);
  const owner = email || rows[0]?.email;
  if (!owner || owner === "unknown") return;

  const stillActive = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.email, owner), inArray(subscriptions.status, ["active", "trialing"])))
    .limit(1);
  if (!stillActive[0]) {
    await db.update(users).set({ regenerationsRemaining: 0 }).where(eq(users.email, owner));
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return Response.json({ error: "Webhook is not configured." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch (error) {
    console.error("Stripe webhook verification failed", error);
    return Response.json({ error: "Invalid webhook signature." }, { status: 400 });
  }

  try {
    const firstDelivery = await recordEvent(event);
    if (!firstDelivery) return Response.json({ received: true, duplicate: true });

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object, new URL(request.url).origin);
    } else if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await handleSubscriptionChange(event.data.object);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", error);
    await getDb().delete(stripeEvents).where(eq(stripeEvents.id, event.id)).catch(() => undefined);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
