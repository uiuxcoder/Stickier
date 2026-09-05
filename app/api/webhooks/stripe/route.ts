import Stripe from "stripe";
import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { generations, orders, stripeEvents, subscriptions, users } from "@/db/schema";
import { MONTHLY_REGENERATIONS } from "@/lib/constants";
import { sendPurchaseEmail } from "@/lib/purchase-email";
import { buildPrintAssets, downloadArchiveKey, printSheetKey } from "@/lib/sticker-archive";
import {
  checkoutEmail,
  customerId,
  getStripe,
  isPaidCheckout,
  periodEndFromSubscription,
  subscriptionIdFromInvoice,
} from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

const STALE_EVENT_CLAIM_MS = 5 * 60 * 1000;

async function notifySlack(session: Stripe.Checkout.Session) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (session.currency || "usd").toUpperCase(),
  }).format((session.amount_total || 0) / 100);
  const plan = session.mode === "subscription"
    ? "Sticker Club subscription"
    : session.metadata?.plan === "physical"
      ? "Digital + physical sticker pack"
      : "Digital sticker pack";
  const email = session.customer_details?.email || session.customer_email || "Not provided";
  const subject = session.metadata?.subject || "Your";
  const stripeUrl = `https://dashboard.stripe.com/${session.livemode ? "payments" : "test/payments"}/${session.payment_intent || session.id}`;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `New Salty Sticker order: ${plan} - ${amount}`,
        blocks: [
          {
            type: "header",
            text: { type: "plain_text", text: "New Salty Sticker order", emoji: true },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${amount}*\n${plan}` },
            accessory: {
              type: "button",
              text: { type: "plain_text", text: "View in Stripe", emoji: true },
              url: stripeUrl,
              action_id: "view_stripe_order",
            },
          },
          { type: "divider" },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Customer*\n${email}` },
              { type: "mrkdwn", text: `*Sticker subject*\n${subject}` },
              { type: "mrkdwn", text: `*Stripe session*\n\`${session.id}\`` },
              { type: "mrkdwn", text: `*Payment mode*\n${session.mode === "subscription" ? "Monthly subscription" : "One-time purchase"}` },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.error("Slack order notification failed", response.status);
  } catch (error) {
    console.error("Slack order notification error", error);
  }
}

async function claimEvent(event: Stripe.Event): Promise<"claimed" | "processed" | "busy"> {
  const db = getDb();
  const now = Date.now();
  const inserted = await db
    .insert(stripeEvents)
    .values({ id: event.id, type: event.type, status: "processing", createdAt: now, updatedAt: now })
    .onConflictDoNothing({ target: stripeEvents.id })
    .returning({ id: stripeEvents.id });
  if (inserted[0]) return "claimed";

  const existing = await db.select({ status: stripeEvents.status, updatedAt: stripeEvents.updatedAt })
    .from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
  if (existing[0]?.status === "processed") return "processed";
  if (existing[0] && existing[0].updatedAt < now - STALE_EVENT_CLAIM_MS) {
    const reclaimed = await db.update(stripeEvents)
      .set({ status: "processing", type: event.type, updatedAt: now })
      .where(and(eq(stripeEvents.id, event.id), lt(stripeEvents.updatedAt, now - STALE_EVENT_CLAIM_MS)))
      .returning({ id: stripeEvents.id });
    if (reclaimed[0]) return "claimed";
  }
  return "busy";
}

async function markProcessed(eventId: string) {
  await getDb().update(stripeEvents)
    .set({ status: "processed", updatedAt: Date.now() })
    .where(eq(stripeEvents.id, eventId));
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

async function ensurePrintAssets(imageKey: string) {
  const bucket = env.STICKER_ASSETS;
  if (await bucket.head(printSheetKey(imageKey))) return;
  const source = await bucket.get(imageKey);
  if (!source) throw new Error(`Sticker source is missing: ${imageKey}`);
  const { archive, printSheet } = await buildPrintAssets(Buffer.from(await source.arrayBuffer()), true);
  await Promise.all([
    bucket.put(downloadArchiveKey(imageKey), archive, {
      httpMetadata: { contentType: "application/zip" },
    }),
    bucket.put(printSheetKey(imageKey), printSheet, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: { dpi: "300", printSize: "4x6" },
    }),
  ]);
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
  const includesStickerBundle = isSubscription ? session.metadata?.source === "purchase-modal" && hasImageKey : hasImageKey;
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

  if (includesStickerBundle) {
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

    if (isSubscription || session.metadata?.plan === "physical") {
      await ensurePrintAssets(imageKey);
    }
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
  await notifySlack(session);

  if (includesStickerBundle) {
    const existing = await db
      .select({ emailSentAt: orders.emailSentAt })
      .from(orders)
      .where(eq(orders.stripeSessionId, session.id))
      .limit(1);
    if (!existing[0]?.emailSentAt) {
      await sendPurchaseEmail(session, email, origin);
      await db.update(orders).set({ emailSentAt: new Date().toISOString() }).where(eq(orders.stripeSessionId, session.id));
    }
  } else if (isSubscription) {
    await sendPurchaseEmail(session, email, origin);
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
    const claim = await claimEvent(event);
    if (claim === "processed") {
      return Response.json({ received: true, duplicate: true });
    }
    if (claim === "busy") {
      return Response.json({ error: "Webhook event is already processing." }, { status: 409 });
    }

    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object, new URL(request.url).origin);
    } else if (event.type === "invoice.paid") {
      await handleInvoicePaid(event.data.object);
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      await handleSubscriptionChange(event.data.object);
    }

    await markProcessed(event.id);
    return Response.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook processing failed", event.id, error);
    await getDb().delete(stripeEvents).where(and(eq(stripeEvents.id, event.id), eq(stripeEvents.status, "processing"))).catch(() => undefined);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
