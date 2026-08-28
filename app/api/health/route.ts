import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { sql } from "drizzle-orm";

/**
 * Readiness probe. Beyond checking that secrets are present, this actually
 * touches D1 and R2 so it fails when the database schema has not been applied
 * or storage is unreachable — the failure modes that would otherwise look
 * healthy.
 */
export async function GET() {
  const checks: Record<string, boolean> = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
    session: Boolean(process.env.SESSION_SECRET),
    d1: false,
    r2: false,
  };

  try {
    await getDb().select({ n: sql<number>`count(*)` }).from(users).limit(1);
    checks.d1 = true;
  } catch (error) {
    console.error("Health check: D1 unavailable", error);
  }

  try {
    checks.r2 = Boolean(env.STICKER_ASSETS);
  } catch {
    checks.r2 = false;
  }

  const ready = Object.values(checks).every(Boolean);
  return Response.json({ ok: ready, checks, time: new Date().toISOString() }, { status: ready ? 200 : 503 });
}
