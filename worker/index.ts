/** Cloudflare Worker entry point for Stickier. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processGenerationJob, type GenerationJobMessage } from "@/lib/generation-worker";
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { sendRenewalReminderEmail } from "@/lib/fulfillment-email";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STICKER_ASSETS: R2Bucket;
  GENERATION_QUEUE: Queue;
  GENERATE_RATE_LIMITER: RateLimit;
  CHECKOUT_RATE_LIMITER: RateLimit;
  DOWNLOAD_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

async function sendRenewalReminders() {
  const now = Date.now();
  const db = getDb();
  const activeSubscriptions = await db
    .select({
      id: subscriptions.stripeSubscriptionId,
      email: subscriptions.email,
      userId: subscriptions.userId,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      reminder3SentAt: subscriptions.renewalReminder3SentAt,
      reminder1SentAt: subscriptions.renewalReminder1SentAt,
    })
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, ["active", "trialing"]), gt(subscriptions.currentPeriodEnd, Math.floor(now / 1000))))
    .all();

  for (const subscription of activeSubscriptions) {
    if (!subscription.currentPeriodEnd) continue;
    const periodEndMs = subscription.currentPeriodEnd * 1000;
    const daysUntilRenewal = periodEndMs - now <= 1 * DAY_MS ? 1 : periodEndMs - now <= 3 * DAY_MS ? 3 : null;
    if (!daysUntilRenewal) continue;
    const sentAt = daysUntilRenewal === 1 ? subscription.reminder1SentAt : subscription.reminder3SentAt;
    if (sentAt) continue;
    const claimed = daysUntilRenewal === 1
      ? await db.update(subscriptions).set({ renewalReminder1SentAt: now }).where(and(eq(subscriptions.stripeSubscriptionId, subscription.id), isNull(subscriptions.renewalReminder1SentAt))).returning({ id: subscriptions.stripeSubscriptionId })
      : await db.update(subscriptions).set({ renewalReminder3SentAt: now }).where(and(eq(subscriptions.stripeSubscriptionId, subscription.id), isNull(subscriptions.renewalReminder3SentAt))).returning({ id: subscriptions.stripeSubscriptionId });
    if (!claimed[0]) continue;
    const profile = subscription.userId
      ? await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, subscription.userId)).limit(1)
      : [];
    const notification = await sendRenewalReminderEmail({
      customerEmail: subscription.email,
      customerName: profile[0]?.fullName,
      daysUntilRenewal,
      renewalDate: new Date(periodEndMs).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    });
    if (!notification.ok) console.error("Renewal reminder failed", subscription.id, notification.error);
  }
}

// The app is embedded by ChatGPT/Apps SDK hosts, so it must not send a blanket
// frame-deny. Clickjacking-sensitive API surface is protected by the signed
// session cookie (SameSite=Lax) and same-origin fetch, not by framing rules.
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

    const response = url.pathname === "/_vinext/image"
      ? await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          if (!env.IMAGES) return new Response("Image optimization is not configured", { status: 501 });
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths)
      : await handler.fetch(request, env, ctx);

    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (url.pathname === "/") headers.set("Cache-Control", "no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  async queue(batch: MessageBatch<GenerationJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processGenerationJob(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Generation job failed", message.body?.jobId, error);
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    await sendRenewalReminders();
  },
};

export default worker;
