import { getDb } from "@/db";
import { users } from "@/db/schema";
import { base64UrlToBytes, bytesToBase64Url, hmacSign, hmacVerify } from "@/lib/crypto";
import { eq } from "drizzle-orm";

/**
 * Stickier-owned authentication.
 *
 * Identity is established by an HMAC-signed session cookie that this app mints
 * and verifies itself. The OpenAI Sites `oai-authenticated-user-*` headers are
 * treated strictly as an untrusted sign-in hint: they can seed a session, but
 * they are never trusted on their own. This keeps the app secure whether it is
 * served behind OpenAI Sites dispatch or directly as a Cloudflare Worker.
 */

export const SESSION_COOKIE = "stickier_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const SESSION_GRACE_MS = 60 * 1000; // tolerate small clock skew on expiry

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

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

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured. Set it with `wrangler secret put SESSION_SECRET`."
    );
  }
  return secret;
}

function encodePayload(payload: SessionPayload): string {
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

export function buildSessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}${secure}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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

/**
 * Establish a session for the given identity, creating the user row on first
 * sign-in. Returns the session user and the Set-Cookie header value to persist
 * it. Uses a surrogate user ID so orders, subscriptions and generations link to
 * a stable identity rather than a mutable email string.
 */
export async function establishSession(
  email: string,
  fullName: string | null
): Promise<{ user: SessionUser; setCookie: string }> {
  const db = getDb();
  const existing = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId: string;
  let displayName: string;
  if (existing[0]) {
    userId = existing[0].id;
    displayName = existing[0].fullName ?? fullName ?? email;
    if (fullName && fullName !== existing[0].fullName) {
      await db.update(users).set({ fullName }).where(eq(users.id, userId));
      displayName = fullName;
    }
  } else {
    userId = crypto.randomUUID();
    displayName = fullName ?? email;
    await db.insert(users).values({
      id: userId,
      email,
      fullName,
      regenerationsRemaining: 0,
      createdAt: Date.now(),
    });
  }

  const token = await createSessionToken({
    uid: userId,
    email,
    name: displayName === email ? null : displayName,
    exp: Date.now() + SESSION_MAX_AGE_S * 1000,
  });

  return {
    user: { id: userId, email, displayName },
    setCookie: buildSessionCookie(token),
  };
}

/** True when the app is running behind a host that injects identity headers. */
export function hasPlatformIdentity(request: Request): boolean {
  return Boolean(request.headers.get(USER_EMAIL_HEADER));
}
