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

/**
 * Record the event only after it has been processed successfully. Recording it
 * first and deleting on failure leaves a window where a crashed isolate makes a
 * paid event look delivered and it is never retried. Stripe retries on any
 * non-2xx, so on failure we simply return 500 and let the redelivery reprocess.
 */
async function hasProcessed(eventId: string) {
  const rows = await getDb()
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, eventId))
    .limit(1);
  return rows.length > 0;
}

async function markProcessed(event: Stripe.Event) {
  await getDb()
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type, createdAt: Date.now() })
    .onConflictDoNothing({ target: stripeEvents.id });
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

/** Resolve the app user for a checkout, preferring the linked userId. */
async function findUserId(email: string, metadataUserId?: string | null) {
  const db = getDb();
  if (metadataUserId) {
    const byId = await db.select({ id: users.id }).from(users).where(eq(users.id, metadataUserId)).limit(1);
    if (byId[0]) return byId[0].id;
  }
  const byEmail = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  return byEmail[0]?.id ?? null;
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, origin: string) {
  if (!isPaidCheckout(session)) return;
  const imageKey = session.metadata?.imageKey;
  const hasImageKey = isImageKey(imageKey);
  const email = checkoutEmail(session);
  if (!email) return;

  const db = getDb();
  const stripeCustomerId = customerId(session.customer);
  const isSubscription = session.mode === "subscription";
  const metadataUserId = session.metadata?.userId ?? null;
  const now = Date.now();

  // Upsert the user keyed on email, then link the stable surrogate ID.
  await db
    .insert(users)
    .values({
      id: metadataUserId ?? crypto.randomUUID(),
      email,
      stripeCustomerId,
      regenerationsRemaining: isSubscription ? MONTHLY_REGENERATIONS : 0,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        stripeCustomerId,
        regenerationsRemaining: isSubscription ? MONTHLY_REGENERATIONS : sql`${users.regenerationsRemaining}`,
      },
    });

  const userId = await findUserId(email, metadataUserId);

  if (hasImageKey) {
    await db
      .insert(orders)
      .values({
        id: crypto.randomUUID(),
        userId,
        email,
        stripeSessionId: session.id,
        kind: isSubscription ? "subscription" : "one-time",
        subject: session.metadata?.subject || "Your",
        imageKey,
        amount: session.amount_total || 0,
        createdAt: now,
      })
      .onConflictDoNothing({ target: orders.stripeSessionId });

    await db
      .update(generations)
      .set({ purchasedAt: now, email, ...(userId ? { userId } : {}) })
      .where(eq(generations.imageKey, imageKey));
  }

  if (isSubscription && typeof session.subscription === "string") {
    await db
      .insert(subscriptions)
      .values({ stripeSubscriptionId: session.subscription, userId, email, status: "active", createdAt: now })
      .onConflictDoUpdate({
        target: subscriptions.stripeSubscriptionId,
        set: { status: "active", email, ...(userId ? { userId } : {}) },
      });
  }

  if (hasImageKey) {
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
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = subscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;
  const db = getDb();

  // Resolve the subscriber from our own records first; Stripe's customer_email
  // is not reliably populated on subscription renewal invoices.
  const sub = await db
    .select({ email: subscriptions.email, userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
    .limit(1);
  const email = invoice.customer_email || invoice.metadata?.email || sub[0]?.email || null;
  const userId = sub[0]?.userId ?? (email ? await findUserId(email) : null);

  if (userId) {
    await db.update(users).set({ regenerationsRemaining: MONTHLY_REGENERATIONS }).where(eq(users.id, userId));
  } else if (email) {
    await db.update(users).set({ regenerationsRemaining: MONTHLY_REGENERATIONS }).where(eq(users.email, email));
  }

  await db
    .update(subscriptions)
    .set({ status: "active", ...(email ? { email } : {}), ...(userId ? { userId } : {}) })
    .where(eq(subscriptions.stripeSubscriptionId, subscriptionId));
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const status = subscription.status;
  const periodEnd = periodEndFromSubscription(subscription);
  const email = subscription.metadata?.email;
  const metadataUserId = subscription.metadata?.userId ?? null;
  const db = getDb();
  const now = Date.now();

  const existing = await db
    .select({ email: subscriptions.email, userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, subscription.id))
    .limit(1);
  const resolvedEmail = email || existing[0]?.email || "unknown";
  const userId =
    metadataUserId ?? existing[0]?.userId ?? (resolvedEmail !== "unknown" ? await findUserId(resolvedEmail) : null);

  await db
    .insert(subscriptions)
    .values({
      stripeSubscriptionId: subscription.id,
      userId,
      email: resolvedEmail,
      status,
      currentPeriodEnd: periodEnd,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: subscriptions.stripeSubscriptionId,
      set: {
        status,
        currentPeriodEnd: periodEnd,
        ...(email ? { email } : {}),
        ...(userId ? { userId } : {}),
      },
    });

  const inactive = status === "canceled" || status === "unpaid" || status === "incomplete_expired";
  if (!inactive) return;

  const owner = resolvedEmail !== "unknown" ? resolvedEmail : null;
  if (!owner) return;

  const stillActive = await db
    .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.email, owner), inArray(subscriptions.status, ["active", "trialing"])))
    .limit(1);
  if (!stillActive[0]) {
    if (userId) {
      await db.update(users).set({ regenerationsRemaining: 0 }).where(eq(users.id, userId));
    } else {
      await db.update(users).set({ regenerationsRemaining: 0 }).where(eq(users.email, owner));
    }
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
    if (await hasProcessed(event.id)) {
      return Response.json({ received: true, duplicate: true });
    }

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object, new URL(request.url).origin);
    } else if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await handleSubscriptionChange(event.data.object);
    }

    await markProcessed(event);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", event.id, error);
    // Do not record the event: returning 500 makes Stripe redeliver it.
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
