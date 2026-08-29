import {
  buildClearSessionCookie,
  establishSession,
  getSessionUser,
  readPlatformIdentityHint,
} from "@/lib/auth";
import { jsonUser } from "@/lib/auth-http";

/**
 * GET: return the current session user, or null.
 *
 * POST: establish a session. When the platform identity header is present
 * (OpenAI Sites dispatch), it seeds the session. This is the only place the
 * platform header is read, and it is converted into a signed, app-owned session
 * cookie rather than being trusted on subsequent requests.
 */
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ user: null });
  return Response.json({ user: jsonUser(user) });
}

export async function POST(request: Request) {
  const hint = readPlatformIdentityHint(request);
  if (!hint) {
    return Response.json({ error: "No identity available to sign in." }, { status: 401 });
  }
  try {
    const { user, setCookie } = await establishSession(hint.email, hint.fullName, request);
    return Response.json({ user: jsonUser(user) }, { headers: { "Set-Cookie": setCookie } });
  } catch (error) {
    console.error("Failed to establish session", error);
    return Response.json({ error: "Unable to sign in." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  return Response.json({ user: null }, { headers: { "Set-Cookie": buildClearSessionCookie(request) } });
}
