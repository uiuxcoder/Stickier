import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  issueEmailVerificationLink,
  mintSessionCookie,
} from "@/lib/auth";
import { sendAlreadyRegisteredEmail, sendVerificationEmail, authEmailOptional } from "@/lib/auth-email";
import { enforceAuthRateLimit, jsonUser } from "@/lib/auth-http";
import { appOrigin, normalizeEmail } from "@/lib/auth-utils";
import { SIGNUP_HOURLY_CAP } from "@/lib/constants";
import { hashPassword, passwordErrorMessage, passwordIssue } from "@/lib/password";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { signUpRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "signup");
  if (limited) return limited;

  const hourly = await consumeRateLimit(undefined, `signup:${await hashIp(request)}`, SIGNUP_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const parsed = signUpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, request.headers.get("cf-connecting-ip") ?? undefined, request.url);
  if (!turnstile.ok) {
    return Response.json({ error: "We could not verify you are human. Please try again." }, { status: 403 });
  }

  const issue = passwordIssue(parsed.data.password);
  if (issue) {
    return Response.json({ error: passwordErrorMessage(issue) }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const fullName = parsed.data.fullName?.trim() || null;
  const passwordHash = await hashPassword(parsed.data.password);
  const db = getDb();
  const now = Date.now();

  const existing = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const signInUrl = `${appOrigin(request)}/signin`;

  if (existing[0]?.passwordHash) {
    await sendAlreadyRegisteredEmail(email, signInUrl).catch((error) =>
      console.error("Failed to send already-registered email", error)
    );
    return Response.json({ needsVerification: true });
  }

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
    await db
      .update(users)
      .set({
        passwordHash,
        fullName: fullName ?? existing[0].fullName,
        emailVerifiedAt: authEmailOptional() ? now : null,
      })
      .where(eq(users.id, userId));
  } else {
    userId = crypto.randomUUID();
    try {
      await db.insert(users).values({
        id: userId,
        email,
        fullName,
        passwordHash,
        emailVerifiedAt: authEmailOptional() ? now : null,
        regenerationsRemaining: 0,
        createdAt: now,
      });
    } catch (error) {
      console.error("Sign-up insert failed", error);
      return Response.json({ error: "Unable to create account." }, { status: 500 });
    }
  }

  if (authEmailOptional()) {
    const { user, setCookie } = await mintSessionCookie({ id: userId, email, fullName }, request);
    return Response.json(
      { user: jsonUser(user), needsVerification: false },
      { headers: { "Set-Cookie": setCookie } }
    );
  }

  try {
    const verifyUrl = await issueEmailVerificationLink(userId, email, request);
    if (process.env.NODE_ENV !== "production") console.info("Verification URL", verifyUrl);
    const sent = await sendVerificationEmail(email, verifyUrl);
    if (!sent.ok) {
      console.error("Verification email failed", sent.error);
      return Response.json({
        needsVerification: true,
        emailed: false,
        error: "We created your account, but could not send the confirmation email. Try resend in a moment.",
      });
    }
  } catch (error) {
    console.error("Verification email failed", error);
    return Response.json({
      needsVerification: true,
      emailed: false,
      error: "We created your account, but could not send the confirmation email. Try resend in a moment.",
    });
  }

  return Response.json({ needsVerification: true });
}
