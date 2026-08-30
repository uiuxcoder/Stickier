import { getDb } from "@/db";
import { users } from "@/db/schema";
import { issuePasswordResetLink } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/auth-email";
import { enforceAuthRateLimit } from "@/lib/auth-http";
import { normalizeEmail } from "@/lib/auth-utils";
import { FORGOT_PASSWORD_HOURLY_CAP } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { forgotPasswordRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "forgot");
  if (limited) return limited;

  const hourly = await consumeRateLimit(
    undefined,
    `forgot:${await hashIp(request)}`,
    FORGOT_PASSWORD_HOURLY_CAP,
    60 * 60 * 1000
  );
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter your email." }, { status: 400 });
  }

  const parsed = forgotPasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email." }, { status: 400 });
  }

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, request.headers.get("cf-connecting-ip") ?? undefined, request.url);
  if (!turnstile.ok) {
    return Response.json({ error: "We could not verify you are human. Please try again." }, { status: 403 });
  }

  const email = normalizeEmail(parsed.data.email);
  const existing = await getDb()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]?.passwordHash) {
    try {
      const resetUrl = await issuePasswordResetLink(existing[0].id, email, request);
      if (process.env.NODE_ENV !== "production") console.info("Password reset URL", resetUrl);
      const sent = await sendPasswordResetEmail(email, resetUrl);
      if (!sent.ok) console.error("Password reset email failed", sent.error);
    } catch (error) {
      console.error("Password reset email failed", error);
    }
  }

  return Response.json({ ok: true });
}
