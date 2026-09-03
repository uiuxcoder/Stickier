import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { createPreviewResponse } from "@/lib/bindings";
import { isImageKey } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!isImageKey(key) || !env.STICKER_ASSETS) {
    return new Response("Preview unavailable", { status: 404 });
  }

  try {
    const generation = await getDb().select().from(generations).where(eq(generations.imageKey, key)).limit(1);
    if (!generation[0]) return new Response("Preview unavailable", { status: 404 });
    if (!generation[0].userId && !generation[0].purchasedAt && Date.now() - generation[0].createdAt > 24 * 60 * 60 * 1000) {
      return new Response("Preview unavailable", { status: 404 });
    }

    const image = await env.STICKER_ASSETS.get(key);
    if (!image) return new Response("Preview unavailable", { status: 404 });
    const preview = await createPreviewResponse(await image.arrayBuffer());
    // Fail closed: never serve the original full-resolution asset as a preview.
    if (!preview) return new Response("Preview unavailable", { status: 503 });
    return preview;
  } catch (error) {
    console.error("Sticker preview failed", error);
    return new Response("Preview unavailable", { status: 500 });
  }
}
