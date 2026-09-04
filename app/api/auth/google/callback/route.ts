import { establishSession } from "@/lib/auth";
import { normalizeEmail } from "@/lib/auth-utils";
import {
  clearGoogleOAuthCookie,
  googleOAuthOrigin,
  GOOGLE_OAUTH_COOKIE,
  readCookie,
  verifyGoogleOAuthState,
} from "@/lib/google-oauth";

type GoogleTokenResponse = { id_token?: string };
type GoogleIdentity = {
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  iss?: string;
  name?: string;
  nonce?: string;
};

function authError(request: Request, code: string, returnTo = "/") {
  const signIn = new URL("/signin", "https://app.local");
  signIn.searchParams.set("error", code);
  signIn.searchParams.set("return_to", returnTo);
  const headers = new Headers({ Location: `${signIn.pathname}${signIn.search}` });
  headers.append("Set-Cookie", clearGoogleOAuthCookie(request));
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const stateParam = requestUrl.searchParams.get("state");
  const stateCookie = readCookie(request, GOOGLE_OAUTH_COOKIE);
  const secret = process.env.SESSION_SECRET;
  const stateCookies = stateCookie?.split(",") || [];
  if (!stateParam || !stateCookies.includes(stateParam) || !secret) {
    return authError(request, "google_state");
  }

  const state = await verifyGoogleOAuthState(stateParam, secret);
  if (!state) return authError(request, "google_state");
  if (requestUrl.searchParams.get("error")) return authError(request, "google_cancelled", state.returnTo);

  const code = requestUrl.searchParams.get("code");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) return authError(request, "google_config", state.returnTo);

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${googleOAuthOrigin(request)}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) throw new Error("Google token exchange failed.");
    const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
    if (!tokens.id_token) throw new Error("Google did not return an identity token.");

    const identityResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
    if (!identityResponse.ok) throw new Error("Google identity verification failed.");
    const identity = (await identityResponse.json()) as GoogleIdentity;
    const issuerValid = identity.iss === "accounts.google.com" || identity.iss === "https://accounts.google.com";
    const emailVerified = identity.email_verified === true || identity.email_verified === "true";
    if (identity.aud !== clientId || identity.nonce !== state.nonce || !issuerValid || !identity.email || !emailVerified) {
      throw new Error("Google identity claims were invalid.");
    }

    const { setCookie } = await establishSession(normalizeEmail(identity.email), identity.name?.trim() || null, request);
    const headers = new Headers({ Location: state.returnTo });
    headers.append("Set-Cookie", setCookie);
    headers.append("Set-Cookie", clearGoogleOAuthCookie(request));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("Google sign-in failed", error);
    return authError(request, "google_failed", state.returnTo);
  }
}