import Stripe from "stripe";
import { env } from "cloudflare:workers";

type AssetObject = { body?: ReadableStream; httpMetadata?: { contentType?: string } };
type AssetBucket = { get(key: string): Promise<AssetObject | null> };

export async function GET(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) return new Response("Not configured", { status: 500 });
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return new Response("Missing session", { status: 400 });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const created = session.created * 1000;
    if (session.payment_status !== "paid" || Date.now() - created > 7 * 24 * 60 * 60 * 1000) {
      return new Response("Download unavailable", { status: 403 });
    }
    const imageKey = session.metadata?.imageKey;
    const bucket = (env as unknown as { STICKER_ASSETS?: AssetBucket }).STICKER_ASSETS;
    if (!imageKey || !bucket) return new Response("Download unavailable", { status: 404 });
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