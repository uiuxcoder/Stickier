import { getDb } from "@/db";
import { users } from "@/db/schema";
import { mintSessionCookie } from "@/lib/auth";
import { enforceAuthRateLimit, jsonUser } from "@/lib/auth-http";
import { normalizeEmail } from "@/lib/auth-utils";
import { AUTH_EMAIL_HOURLY_CAP } from "@/lib/constants";
import { verifyPassword, verifyPasswordDummy } from "@/lib/password";
import { consumeRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { signInRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "signin");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const parsed = signInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Enter a valid email and password." }, { status: 400 });
  }

  const email = normalizeEmail(parsed.data.email);
  const emailLimit = await consumeRateLimit(undefined, `signin:${email}`, AUTH_EMAIL_HOURLY_CAP, 60 * 60 * 1000);
  if (!emailLimit.ok) return rateLimitResponse(emailLimit.retryAfterMs);

  const existing = await getDb()
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

  const row = existing[0];
  if (!row) {
    await verifyPasswordDummy(parsed.data.password);
    return Response.json(
      {
        error:
          "No Sticker Club account found for this email. You can still access your one-time purchase from the download link in your confirmation email.",
      },
      { status: 401 }
    );
  }

  if (!row.passwordHash) {
    await verifyPasswordDummy(parsed.data.password);
    return Response.json(
      {
        error:
          "No Sticker Club account found for this email. You can still access your one-time purchase from the download link in your confirmation email.",
      },
      { status: 401 }
    );
  }

  const matches = await verifyPassword(parsed.data.password, row.passwordHash);
  if (!matches) {
    return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
  }

  if (!row.emailVerifiedAt) {
    return Response.json(
      { error: "Confirm your email before signing in.", code: "unverified" },
      { status: 403 }
    );
  }

  const { user, setCookie } = await mintSessionCookie(row, request);
  return Response.json({ user: jsonUser(user) }, { headers: { "Set-Cookie": setCookie } });
}
