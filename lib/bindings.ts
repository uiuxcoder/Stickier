import { env } from "cloudflare:workers";
import { PREVIEW_QUALITY, PREVIEW_WIDTH } from "@/lib/constants";
import { base64UrlToBytes, bytesToBase64Url, hmacSign, hmacVerify } from "@/lib/crypto";

export function getAssetBucket() {
  const bucket = env.STICKER_ASSETS;
  if (!bucket) {
    throw new Error("R2 binding `STICKER_ASSETS` is unavailable.");
  }
  return bucket;
}

/**
 * Render the low-resolution, watermarked preview shown before purchase.
 *
 * Fails closed: when the Images binding is unavailable we return null rather
 * than the original full-resolution asset, so the paid image is never exposed
 * through the preview path.
 */
export async function createPreviewResponse(
  image: ArrayBuffer | Uint8Array | ReadableStream
): Promise<Response | null> {
  const images = env.IMAGES;
  if (!images) {
    console.error("IMAGES binding is not configured; refusing to serve an unwatermarked preview.");
    return null;
  }

  const body = image instanceof ReadableStream ? image : new Blob([image as BlobPart]).stream();
  const result = await images
    .input(body)
    .transform({ width: PREVIEW_WIDTH, fit: "scale-down" })
    .output({ format: "image/jpeg", quality: PREVIEW_QUALITY });
  const response = await result.response();
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Stickier-Preview", "watermarked");
  return new Response(response.body, { status: 200, headers });
}

/**
 * Mint a short-lived, HMAC-signed token authorizing a single photo upload to a
 * specific R2 key. This lets the browser PUT a photo directly to an upload
 * endpoint without routing multi-megabyte base64 through a JSON request body.
 */
export async function signUploadToken(key: string, expiresInMs = 10 * 60 * 1000): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  const exp = Date.now() + expiresInMs;
  const payload = `${key}.${exp}`;
  const signature = await hmacSign(payload, secret);
  return `${bytesToBase64Url(new TextEncoder().encode(payload))}.${signature}`;
}

export async function verifyUploadToken(token: string, key: string): Promise<boolean> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = new TextDecoder().decode(base64UrlToBytes(token.slice(0, dot)));
  const signature = token.slice(dot + 1);

  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return false;
  const payloadKey = payload.slice(0, sep);
  const exp = Number(payload.slice(sep + 1));
  if (payloadKey !== key || !Number.isFinite(exp) || Date.now() > exp) return false;

  return hmacVerify(payload, signature, secret);
}
