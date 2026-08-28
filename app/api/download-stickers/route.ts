import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { DOWNLOAD_HOURLY_CAP, DOWNLOAD_WINDOW_MS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { isImageKey } from "@/lib/validation";
import { eq } from "drizzle-orm";

/**
 * Serve a purchased sticker sheet. Authorization comes from the local orders
 * table (written by the verified Stripe webhook), not from a live Stripe call,
 * so downloads stay fast and do not depend on Stripe availability.
 */
export async function GET(request: Request) {
  const hourly = await consumeRateLimit(rateLimiters().download, `download:${await hashIp(request)}`, DOWNLOAD_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return new Response("Download unavailable", { status: 404 });

  try {
    const order = await getDb()
      .select()
      .from(orders)
      .where(eq(orders.stripeSessionId, sessionId))
      .limit(1);

    const record = order[0];
    if (!record || !isImageKey(record.imageKey)) {
      return new Response("Download unavailable", { status: 404 });
    }

    // Enforce the download window from the order's creation time.
    if (Date.now() - record.createdAt > DOWNLOAD_WINDOW_MS) {
      return new Response("Download unavailable", { status: 404 });
    }

    const bucket = env.STICKER_ASSETS;
    if (!bucket) return new Response("Download unavailable", { status: 500 });

    const image = await bucket.get(record.imageKey);
    if (!image?.body) return new Response("Download unavailable", { status: 404 });

    return new Response(image.body, {
      headers: {
        "Content-Type": image.httpMetadata?.contentType || "image/png",
        "Content-Disposition": "attachment; filename=stickier-stickers.png",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Sticker download failed", error);
    return new Response("Download unavailable", { status: 500 });
  }
}
