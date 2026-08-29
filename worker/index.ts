/** Cloudflare Worker entry point for Stickier. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { processGenerationJob, type GenerationJobMessage } from "@/lib/generation-worker";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STICKER_ASSETS: R2Bucket;
  GENERATION_QUEUE: Queue;
  GENERATE_RATE_LIMITER: RateLimit;
  CHECKOUT_RATE_LIMITER: RateLimit;
  DOWNLOAD_RATE_LIMITER: RateLimit;
  AUTH_RATE_LIMITER?: RateLimit;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// The app is embedded by ChatGPT/Apps SDK hosts, so it must not send a blanket
// frame-deny. Clickjacking-sensitive API surface is protected by the signed
// session cookie (SameSite=Lax) and same-origin fetch, not by framing rules.
const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];

    const response = url.pathname === "/_vinext/image"
      ? await handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          if (!env.IMAGES) return new Response("Image optimization is not configured", { status: 501 });
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths)
      : await handler.fetch(request, env, ctx);

    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  async queue(batch: MessageBatch<GenerationJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processGenerationJob(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Generation job failed", message.body?.jobId, error);
        message.retry();
      }
    }
  },
};

export default worker;
