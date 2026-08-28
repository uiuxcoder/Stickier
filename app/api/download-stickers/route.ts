import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { DOWNLOAD_HOURLY_CAP, DOWNLOAD_WINDOW_MS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { getStripe, isPaidCheckout } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) return new Response("Not configured", { status: 500 });
  const hourly = await consumeRateLimit(`download:${await hashIp(request)}`, DOWNLOAD_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return new Response("Download unavailable", { status: 404 });

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    const created = session.created * 1000;
    if (!isPaidCheckout(session) || Date.now() - created > DOWNLOAD_WINDOW_MS) {
      return new Response("Download unavailable", { status: 404 });
    }

    const order = await getDb().select().from(orders).where(eq(orders.stripeSessionId, sessionId)).limit(1);
    const imageKey = order[0]?.imageKey || session.metadata?.imageKey;
    const bucket = env.STICKER_ASSETS;
    if (!isImageKey(imageKey) || !bucket) return new Response("Download unavailable", { status: 404 });

    const image = await bucket.get(imageKey);
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
