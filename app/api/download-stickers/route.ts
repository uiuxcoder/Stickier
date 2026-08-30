import { env } from "cloudflare:workers";
import { decode as decodePng, encode as encodePng } from "fast-png";
import JSZip from "jszip";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
import { DOWNLOAD_HOURLY_CAP, DOWNLOAD_WINDOW_MS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";
import { eq } from "drizzle-orm";

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

function buildStickerTiles(sheet: Buffer) {
  const decoded = decodePng(sheet);
  const { width, height, channels, data } = decoded;

  // Normalize to 8-bit RGBA regardless of the source PNG's color type so the
  // tile-cropping math below can assume 4 bytes per pixel.
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, pixel = 0; pixel < width * height; pixel++, i += channels) {
    const r = data[i];
    const g = channels >= 3 ? data[i + 1] : r;
    const b = channels >= 3 ? data[i + 2] : r;
    const a = channels === 2 ? data[i + 1] : channels === 4 ? data[i + 3] : 255;
    const o = pixel * 4;
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    rgba[o + 3] = a;
  }

  const tileWidth = Math.max(1, Math.floor(width / 3));
  const tileHeight = Math.max(1, Math.floor(height / 4));
  const cells = [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 2 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 1 },
    { row: 2, col: 2 },
    { row: 3, col: 1 },
  ];

  return cells.map((cell, index) => {
    const x = Math.min(width - tileWidth, cell.col * tileWidth);
    const y = Math.min(height - tileHeight, cell.row * tileHeight);
    const out = new Uint8Array(tileWidth * tileHeight * 4);

    for (let py = 0; py < tileHeight; py++) {
      for (let px = 0; px < tileWidth; px++) {
        const srcIndex = ((y + py) * width + (x + px)) * 4;
        const dstIndex = (py * tileWidth + px) * 4;
        out[dstIndex] = rgba[srcIndex];
        out[dstIndex + 1] = rgba[srcIndex + 1];
        out[dstIndex + 2] = rgba[srcIndex + 2];
        out[dstIndex + 3] = rgba[srcIndex + 3];
      }
    }

    return {
      name: `sticker-${String(index + 1).padStart(2, "0")}.png`,
      buffer: encodePng({ width: tileWidth, height: tileHeight, data: out, channels: 4, depth: 8 }),
    };
  });
}

async function buildDownloadArchive(sheetBuffer: Buffer) {
  const zip = new JSZip();
  zip.file("full-sheet.png", sheetBuffer);
  for (const tile of buildStickerTiles(sheetBuffer)) {
    zip.file(tile.name, tile.buffer);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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
    const resolvedKey = sessionId ? await resolveImageKey(sessionId, imageKey) : (imageKey && isImageKey(imageKey) ? imageKey : null);
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
