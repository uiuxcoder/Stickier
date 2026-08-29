/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    STICKER_ASSETS: R2Bucket;
    ASSETS: Fetcher;
    IMAGES?: {
      input(stream: ReadableStream): {
        transform(options: Record<string, unknown>): {
          output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
        };
      };
    };
    GENERATION_QUEUE: Queue;
    GENERATE_RATE_LIMITER: RateLimit;
    CHECKOUT_RATE_LIMITER: RateLimit;
    DOWNLOAD_RATE_LIMITER: RateLimit;
    AUTH_RATE_LIMITER?: RateLimit;
  }
}
