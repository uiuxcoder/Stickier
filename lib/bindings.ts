import { env } from "cloudflare:workers";

export function getAssetBucket() {
  const bucket = env.STICKER_ASSETS;
  if (!bucket) {
    throw new Error("R2 binding `STICKER_ASSETS` is unavailable.");
  }
  return bucket;
}

export async function createPreviewResponse(image: ArrayBuffer | Uint8Array | ReadableStream, contentType = "image/png") {
  const images = env.IMAGES;
  if (!images) {
    return new Response(image as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
        "X-Stickier-Preview": "untransformed",
      },
    });
  }

  const body = image instanceof ReadableStream ? image : new Blob([image as BlobPart]).stream();
  const result = await images
    .input(body)
    .transform({ width: 640, fit: "scale-down" })
    .output({ format: "jpeg", quality: 38 });
  const response = await result.response();
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("X-Stickier-Preview", "transformed");
  return new Response(response.body, { status: 200, headers });
}
