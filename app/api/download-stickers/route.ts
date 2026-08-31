import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { generations, orders } from "@/db/schema";
import { DOWNLOAD_HOURLY_CAP, DOWNLOAD_WINDOW_MS } from "@/lib/constants";
import { getSessionUser } from "@/lib/auth";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { buildDownloadArchive } from "@/lib/sticker-archive";
import { getStripe } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { and, eq } from "drizzle-orm";

async function resolveImageKey(sessionId: string, fallbackKey?: string | null) {
  const explicitKey = fallbackKey && isImageKey(fallbackKey) ? fallbackKey : null;
  if (explicitKey) return explicitKey;

  const order = await getDb()
    .select({ imageKey: orders.imageKey, createdAt: orders.createdAt })
    .from(orders)
    .where(eq(orders.stripeSessionId, sessionId))
    .limit(1);

  const record = order[0];
  if (record && isImageKey(record.imageKey)) return record.imageKey;

  if (!process.env.STRIPE_SECRET_KEY) return null;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const imageKey = typeof session.metadata?.imageKey === "string" ? session.metadata.imageKey : null;
    if (isImageKey(imageKey)) return imageKey;
  } catch (error) {
    console.error("Stripe session lookup for download failed", error);
  }

  return null;
}

async function resolveMemberImageKey(request: Request, imageKey: string | null) {
  if (!imageKey || !isImageKey(imageKey)) return null;
  const user = await getSessionUser(request);
  if (!user) return null;

  const generation = await getDb()
    .select({ imageKey: generations.imageKey })
    .from(generations)
    .where(and(eq(generations.imageKey, imageKey), eq(generations.userId, user.id)))
    .limit(1);
  return generation[0]?.imageKey ?? null;
}

/**
 * Serve a purchased sticker sheet bundle: the full sheet PNG plus each tile as
 * an individual PNG in a zip archive. This remains compatible with local dev
 * where the Stripe webhook may not have created the orders row yet.
 */
export async function GET(request: Request) {
  const hourly = await consumeRateLimit(rateLimiters().download, `download:${await hashIp(request)}`, DOWNLOAD_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const imageKey = url.searchParams.get("image_key");
  const bucket = env.STICKER_ASSETS;
  if (!bucket) return new Response("Download unavailable", { status: 500 });

  if (!sessionId && !imageKey) return new Response("Download unavailable", { status: 404 });

  try {
    const resolvedKey = sessionId
      ? await resolveImageKey(sessionId, imageKey)
      : await resolveMemberImageKey(request, imageKey);
    if (!resolvedKey) return new Response("Download unavailable", { status: 404 });

    const order = sessionId
      ? await getDb().select({ createdAt: orders.createdAt }).from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1)
      : [];
    const createdAt = order[0]?.createdAt ?? Date.now();
    if (Date.now() - createdAt > DOWNLOAD_WINDOW_MS) {
      return new Response("Download unavailable", { status: 404 });
    }

    const image = await bucket.get(resolvedKey);
    if (!image?.body) return new Response("Download unavailable", { status: 404 });

    const sheetBuffer = Buffer.from(await image.arrayBuffer());
    const archive = await buildDownloadArchive(sheetBuffer);

    return new Response(archive, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename=stickier-stickers-${resolvedKey.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Sticker download failed", error);
    return new Response("Download unavailable", { status: 500 });
  }
}
