import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

function clientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function hashIp(request: Request) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`stickier:${clientIp(request)}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type RateOutcome = { ok: true; remaining?: number } | { ok: false; retryAfterMs: number };

/**
 * Enforce a rate limit. Prefers the Workers Rate Limiting binding (fast,
 * in-memory, per-location) and falls back to a D1-backed counter when the
 * binding is not configured. The binding is intentionally not an exact
 * accounting system; it is a cheap abuse brake. Exact quota accounting lives in
 * the users table, not here.
 */
export async function consumeRateLimit(
  limiter: RateLimit | undefined,
  key: string,
  limit: number,
  windowMs: number
): Promise<RateOutcome> {
  if (limiter) {
    const { success } = await limiter.limit({ key });
    return success ? { ok: true } : { ok: false, retryAfterMs: windowMs };
  }
  return consumeD1RateLimit(key, limit, windowMs);
}

async function consumeD1RateLimit(key: string, limit: number, windowMs: number): Promise<RateOutcome> {
  const now = Date.now();
  const resetAt = now + windowMs;
  const db = getDb();

  await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.resetAt} < ${now} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimits.resetAt} < ${now} THEN ${resetAt} ELSE ${rateLimits.resetAt} END`,
      },
    });

  const rows = await db.select().from(rateLimits).where(eq(rateLimits.key, key)).limit(1);
  const count = rows[0]?.count ?? 1;
  if (count > limit) {
    return { ok: false as const, retryAfterMs: Math.max(0, (rows[0]?.resetAt ?? resetAt) - now) };
  }
  return { ok: true as const, remaining: Math.max(0, limit - count) };
}

export function rateLimitResponse(retryAfterMs: number) {
  return Response.json(
    { error: "Too many requests. Please wait and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000) || 60) },
    },
  );
}

export function rateLimiters() {
  return {
    generate: env.GENERATE_RATE_LIMITER,
    checkout: env.CHECKOUT_RATE_LIMITER,
    download: env.DOWNLOAD_RATE_LIMITER,
    auth: env.AUTH_RATE_LIMITER,
  };
}
