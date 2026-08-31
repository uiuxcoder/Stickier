import { getDb } from "@/db";
import { users } from "@/db/schema";
import { mintSessionCookie, verifyEmailToken } from "@/lib/auth";
import { enforceAuthRateLimit, jsonUser } from "@/lib/auth-http";
import { sha256Hex } from "@/lib/crypto";
import { hashPassword, passwordErrorMessage, passwordIssue } from "@/lib/password";
import { resetPasswordRequestSchema } from "@/lib/validation";
import { and, eq, gt } from "drizzle-orm";

export async function POST(request: Request) {
  const limited = await enforceAuthRateLimit(request, "reset");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Choose a new password." }, { status: 400 });
  }

  const parsed = resetPasswordRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const issue = passwordIssue(parsed.data.password);
  if (issue) {
    return Response.json({ error: passwordErrorMessage(issue) }, { status: 400 });
  }

  const payload = await verifyEmailToken(parsed.data.token, "reset");
  if (!payload) {
    return Response.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const tokenHash = await sha256Hex(parsed.data.token);
  const db = getDb();
  const existing = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      passwordResetTokenHash: users.passwordResetTokenHash,
      passwordResetExpiresAt: users.passwordResetExpiresAt,
    })
    .from(users)
    .where(
      and(
        eq(users.id, payload.uid),
        eq(users.email, payload.email),
        eq(users.passwordResetTokenHash, tokenHash),
        gt(users.passwordResetExpiresAt, Date.now())
      )
    )
    .limit(1);

  if (!existing[0]) {
    return Response.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await db
    .update(users)
    .set({
      passwordHash,
      emailVerifiedAt: Date.now(),
      passwordResetTokenHash: null,
      passwordResetExpiresAt: null,
    })
    .where(eq(users.id, existing[0].id));

  const { user, setCookie } = await mintSessionCookie(existing[0], request);
  return Response.json({ user: jsonUser(user) }, { headers: { "Set-Cookie": setCookie } });
}
