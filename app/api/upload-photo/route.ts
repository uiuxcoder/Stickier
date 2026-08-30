import { env } from "cloudflare:workers";
import { MAX_PHOTO_BYTES, UPLOAD_KEY_PATTERN } from "@/lib/constants";
import { signUploadToken, verifyUploadToken } from "@/lib/bindings";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import {
  extensionForImageType,
  isOpenAIImageType,
  OPENAI_IMAGE_TYPES,
  sniffImageType,
} from "@/lib/image-format";

const ALLOWED_TYPES = new Set<string>(OPENAI_IMAGE_TYPES);

/**
 * POST: request a short-lived upload URL. Returns an object key and a signed
 * token. The client then PUTs the raw image bytes to this same route, keeping
 * multi-megabyte photos out of the JSON request body.
 *
 * PUT: receive the raw image bytes for a previously issued key+token and store
 * them in R2.
 */
export async function POST(request: Request) {
  const hourly = await consumeRateLimit(rateLimiters().generate, `upload:${await hashIp(request)}`, 30, 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  let contentType = "image/png";
  try {
    const body = (await request.json()) as { contentType?: string };
    if (body.contentType && ALLOWED_TYPES.has(body.contentType)) contentType = body.contentType;
  } catch {
    // No body is fine; default to png.
  }

  const key = `uploads/${crypto.randomUUID()}/${crypto.randomUUID()}.${extensionForImageType(contentType)}`;
  if (!UPLOAD_KEY_PATTERN.test(key)) {
    return Response.json({ error: "Could not prepare upload." }, { status: 500 });
  }
  const token = await signUploadToken(key);
  return Response.json({ key, token, contentType });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const token = url.searchParams.get("token") ?? "";
  if (!UPLOAD_KEY_PATTERN.test(key) || !(await verifyUploadToken(token, key))) {
    return Response.json({ error: "Invalid upload." }, { status: 403 });
  }

  const declaredType = request.headers.get("content-type") ?? "image/png";
  if (!ALLOWED_TYPES.has(declaredType)) {
    return Response.json({ error: "Unsupported image type." }, { status: 415 });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
    return Response.json({ error: "Image is empty or too large." }, { status: 413 });
  }

  // Trust the bytes, not the header. Phone galleries hand back HEIC under a
  // generic type, and passing those through to OpenAI fails the whole
  // generation with an opaque "invalid image file" error.
  const contentType = sniffImageType(bytes);
  if (!isOpenAIImageType(contentType)) {
    return Response.json(
      { error: "That image format is not supported. Please upload a JPEG, PNG, or WebP." },
      { status: 415 }
    );
  }

  const bucket = env.STICKER_ASSETS;
  if (!bucket) return Response.json({ error: "Storage is not configured." }, { status: 500 });

  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  return Response.json({ key });
}
