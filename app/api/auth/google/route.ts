import { safeRelativeReturnPath } from "@/lib/auth-utils";
import { createGoogleOAuthState, googleOAuthCookie, googleOAuthOrigin, readCookie, verifyGoogleOAuthState } from "@/lib/google-oauth";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const returnTo = safeRelativeReturnPath(requestUrl.searchParams.get("return_to"));
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.SESSION_SECRET;
  if (!clientId || !secret) {
    const signIn = new URL("/signin", "https://app.local");
    signIn.searchParams.set("error", "google_config");
    signIn.searchParams.set("return_to", returnTo);
    return new Response(null, { status: 302, headers: { Location: `${signIn.pathname}${signIn.search}` } });
  }

  const state = await createGoogleOAuthState(returnTo, secret);
  const statePayload = await verifyGoogleOAuthState(state, secret);
  if (!statePayload) return new Response(null, { status: 302, headers: { Location: "/signin?error=google_failed" } });
  const callbackUrl = `${googleOAuthOrigin(request)}/api/auth/google/callback`;
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", callbackUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("nonce", statePayload.nonce);
  authorizationUrl.searchParams.set("prompt", "select_account");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      "Set-Cookie": googleOAuthCookie(state, request, readCookie(request, "stickier_google_oauth")),
    },
  });
}