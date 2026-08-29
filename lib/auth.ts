import { getDb } from "@/db";
import { users } from "@/db/schema";
import { base64UrlToBytes, bytesToBase64Url, hmacSign, hmacVerify, sha256Hex } from "@/lib/crypto";
import { appOrigin } from "@/lib/auth-utils";
import { EMAIL_VERIFY_TTL_MS, PASSWORD_RESET_TTL_MS } from "@/lib/constants";
import { eq } from "drizzle-orm";

/**
 * Stickier-owned authentication.
 *
 * Identity is established by an HMAC-signed session cookie that this app mints
 * and verifies itself. Email/password is the primary production path. The
 * OpenAI Sites `oai-authenticated-user-*` headers remain an untrusted sign-in
 * hint: they can seed a session, but they are never trusted on their own.
 */

export const SESSION_COOKIE = "stickier_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const SESSION_GRACE_MS = 60 * 1000; // tolerate small clock skew on expiry

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

/**
 * A session only exists for a confirmed identity: every mint path either
 * verified the email or came from a platform-verified hint, so callers do not
 * need to re-check verification.
 */
export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

type SessionPayload = {
  uid: string;
  email: string;
  name: string | null;
  exp: number;
};

type EmailTokenPurpose = "verify" | "reset";

type EmailTokenPayload = {
  v: 1;
  p: EmailTokenPurpose;
  uid: string;
  email: string;
  exp: number;
};

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured. Set it with `wrangler secret put SESSION_SECRET`."
    );
  }
  return secret;
}

function encodePayload(payload: object): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodePayload(value: string): SessionPayload | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.uid !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return {
      uid: parsed.uid,
      email: parsed.email,
      name: typeof parsed.name === "string" ? parsed.name : null,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

function decodeEmailTokenPayload(value: string): EmailTokenPayload | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.v !== 1 ||
      (parsed.p !== "verify" && parsed.p !== "reset") ||
      typeof parsed.uid !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    return { v: 1, p: parsed.p, uid: parsed.uid, email: parsed.email, exp: parsed.exp };
  } catch {
    return null;
  }
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const encoded = encodePayload(payload);
  const signature = await hmacSign(encoded, getSessionSecret());
  return `${encoded}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  const valid = await hmacVerify(encoded, signature, secret);
  if (!valid) return null;

  const payload = decodePayload(encoded);
  if (!payload) return null;
  if (Date.now() > payload.exp + SESSION_GRACE_MS) return null;
  return payload;
}

export async function createEmailToken(
  purpose: EmailTokenPurpose,
  uid: string,
  email: string,
  ttlMs: number
): Promise<string> {
  const encoded = encodePayload({ v: 1, p: purpose, uid, email, exp: Date.now() + ttlMs });
  const signature = await hmacSign(encoded, getSessionSecret());
  return `${encoded}.${signature}`;
}

export async function verifyEmailToken(
  token: string,
  purpose: EmailTokenPurpose
): Promise<EmailTokenPayload | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    return null;
  }

  const valid = await hmacVerify(encoded, signature, secret);
  if (!valid) return null;

  const payload = decodeEmailTokenPayload(encoded);
  if (!payload || payload.p !== purpose) return null;
  if (Date.now() > payload.exp + SESSION_GRACE_MS) return null;
  return payload;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSessionTokenFromRequest(request: Request): string | null {
  return parseCookies(request.headers.get("cookie"))[SESSION_COOKIE] ?? null;
}

function cookieSecureFlag(request?: Request): string {
  if (process.env.NODE_ENV === "production") return "; Secure";
  if (request && new URL(request.url).protocol === "https:") return "; Secure";
  return "";
}

export function buildSessionCookie(token: string, request?: Request): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${cookieSecureFlag(request)}`;
}

export function buildClearSessionCookie(request?: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag(request)}`;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Read the platform-provided identity hint. Never trusted on its own. */
export function readPlatformIdentityHint(request: Request): {
  email: string;
  fullName: string | null;
} | null {
  const email = request.headers.get(USER_EMAIL_HEADER);
  if (!email) return null;
  const encodedFullName = request.headers.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    request.headers.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecode(encodedFullName)
      : null;
  return { email, fullName };
}

/**
 * Resolve the current signed-in user from the session cookie. Returns null when
 * there is no valid session. This is the only trusted source of identity.
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  return {
    id: payload.uid,
    email: payload.email,
    displayName: payload.name ?? payload.email,
  };
}

export async function mintSessionCookie(
  user: { id: string; email: string; fullName?: string | null },
  request?: Request
): Promise<{ user: SessionUser; setCookie: string }> {
  const displayName = user.fullName || user.email;
  const token = await createSessionToken({
    uid: user.id,
    email: user.email,
    name: displayName === user.email ? null : displayName,
    exp: Date.now() + SESSION_MAX_AGE_S * 1000,
  });
  return {
    user: { id: user.id, email: user.email, displayName },
    setCookie: buildSessionCookie(token, request),
  };
}

/**
 * Establish a session for the given identity, creating the user row on first
 * sign-in. Returns the session user and the Set-Cookie header value to persist
 * it. Uses a surrogate user ID so orders, subscriptions and generations link to
 * a stable identity rather than a mutable email string.
 */
export async function establishSession(
  email: string,
  fullName: string | null,
  request?: Request
): Promise<{ user: SessionUser; setCookie: string }> {
  const db = getDb();
  const existing = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  let displayName: string;
  const now = Date.now();
  if (existing[0]) {
    userId = existing[0].id;
    displayName = existing[0].fullName ?? fullName ?? email;
    const patch: { fullName?: string; emailVerifiedAt?: number } = {};
    if (fullName && fullName !== existing[0].fullName) {
      patch.fullName = fullName;
      displayName = fullName;
    }
    if (!existing[0].emailVerifiedAt) patch.emailVerifiedAt = now;
    if (Object.keys(patch).length > 0) {
      await db.update(users).set(patch).where(eq(users.id, userId));
    }
  } else {
    userId = crypto.randomUUID();
    displayName = fullName ?? email;
    await db.insert(users).values({
      id: userId,
      email,
      fullName,
      emailVerifiedAt: now,
      regenerationsRemaining: 0,
      createdAt: now,
    });
  }

  return mintSessionCookie({ id: userId, email, fullName: displayName === email ? null : displayName }, request);
}

export async function issueEmailVerificationLink(userId: string, email: string, request: Request): Promise<string> {
  const token = await createEmailToken("verify", userId, email, EMAIL_VERIFY_TTL_MS);
  return `${appOrigin(request)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
}

export async function issuePasswordResetLink(userId: string, email: string, request: Request): Promise<string> {
  const token = await createEmailToken("reset", userId, email, PASSWORD_RESET_TTL_MS);
  await getDb()
    .update(users)
    .set({
      passwordResetTokenHash: await sha256Hex(token),
      passwordResetExpiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
    })
    .where(eq(users.id, userId));
  return `${appOrigin(request)}/reset-password?token=${encodeURIComponent(token)}`;
}

/** True when the app is running behind a host that injects identity headers. */
export function hasPlatformIdentity(request: Request): boolean {
  return Boolean(request.headers.get(USER_EMAIL_HEADER));
}
