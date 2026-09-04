import { base64UrlToBytes, bytesToBase64Url, hmacSign, hmacVerify } from "./crypto.ts";
import { safeRelativeReturnPath } from "./auth-utils.ts";

export const GOOGLE_OAUTH_COOKIE = "stickier_google_oauth";
const GOOGLE_OAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_GOOGLE_OAUTH_STATES = 3;

export function googleOAuthOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  const candidate = new URL(configured || request.url);
  if (candidate.hostname === "localhost" || candidate.hostname === "127.0.0.1") {
    return `http://${candidate.hostname}:5173`;
  }
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return "https://saltysticker.com";
  return candidate.origin;
}

type GoogleOAuthState = {
  nonce: string;
  returnTo: string;
  exp: number;
};

function encodeState(state: GoogleOAuthState) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(state)));
}

function decodeState(value: string): GoogleOAuthState | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.returnTo !== "string" ||
      typeof parsed.exp !== "number"
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function createGoogleOAuthState(returnTo: string, secret: string, now = Date.now()) {
  const payload = encodeState({
    nonce: crypto.randomUUID(),
    returnTo: safeRelativeReturnPath(returnTo),
    exp: now + GOOGLE_OAUTH_TTL_MS,
  });
  return `${payload}.${await hmacSign(payload, secret)}`;
}

export async function verifyGoogleOAuthState(token: string, secret: string, now = Date.now()) {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!(await hmacVerify(payload, signature, secret))) return null;
  const state = decodeState(payload);
  if (!state || now > state.exp) return null;
  return { ...state, returnTo: safeRelativeReturnPath(state.returnTo) };
}

// The callback redirect_uri is pinned to the apex domain, but users may start
// the flow from www. Scope the cookie to the whole domain so it still reaches
// the callback regardless of which host issued it.
function cookieDomainAttribute(request: Request) {
  const hostname = new URL(googleOAuthOrigin(request)).hostname;
  return hostname === "saltysticker.com" ? "; Domain=.saltysticker.com" : "";
}

export function googleOAuthCookie(token: string, request: Request, previousCookie?: string | null) {
  const secure = googleOAuthOrigin(request).startsWith("https://") ? "; Secure" : "";
  const domain = cookieDomainAttribute(request);
  const previous = previousCookie ? previousCookie.split(",").filter(Boolean) : [];
  const states = [token, ...previous.filter((value) => value !== token)].slice(0, MAX_GOOGLE_OAUTH_STATES);
  return `${GOOGLE_OAUTH_COOKIE}=${encodeURIComponent(states.join(","))}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${secure}${domain}`;
}

export function clearGoogleOAuthCookie(request: Request) {
  const secure = googleOAuthOrigin(request).startsWith("https://") ? "; Secure" : "";
  const domain = cookieDomainAttribute(request);
  return `${GOOGLE_OAUTH_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${secure}${domain}`;
}

export function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}