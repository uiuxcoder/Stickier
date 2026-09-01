import { env } from "cloudflare:workers";
import { and, eq, gt } from "drizzle-orm";
import { decode, encode } from "fast-png";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { isImageKey } from "@/lib/validation";

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const index = Number(url.searchParams.get("index"));
  if (!isImageKey(key) || !Number.isInteger(index) || index < 0 || index > 9 || !env.STICKER_ASSETS) {
    return new Response("Preview unavailable", { status: 404 });
  }

  try {
    const generation = await getDb()
      .select({ imageKey: generations.imageKey })
      .from(generations)
      .where(and(eq(generations.imageKey, key), gt(generations.createdAt, Date.now() - PREVIEW_TTL_MS)))
      .limit(1);
    if (!generation[0]) return new Response("Preview unavailable", { status: 404 });

    const image = await env.STICKER_ASSETS.get(key);
    if (!image) return new Response("Preview unavailable", { status: 404 });
    const decoded = decode(new Uint8Array(await image.arrayBuffer()));
    const column = index === 9 ? 1 : index % 3;
    const row = Math.floor(index / 3);
    const cellWidth = Math.floor(decoded.width / 3);
    const cellHeight = Math.floor(decoded.height / 4);
    const channels = decoded.channels;
    const tile = new Uint8Array(cellWidth * cellHeight * channels);

    for (let y = 0; y < cellHeight; y++) {
      const sourceStart = ((row * cellHeight + y) * decoded.width + column * cellWidth) * channels;
      const targetStart = y * cellWidth * channels;
      tile.set(decoded.data.subarray(sourceStart, sourceStart + cellWidth * channels), targetStart);
    }

    return new Response(encode({ width: cellWidth, height: cellHeight, data: tile, channels }), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Sticker tile preview failed", error);
    return new Response("Preview unavailable", { status: 500 });
  }
}