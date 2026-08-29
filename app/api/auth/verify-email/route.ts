import { getDb } from "@/db";
import { users } from "@/db/schema";
import { mintSessionCookie, verifyEmailToken } from "@/lib/auth";
import { jsonUser } from "@/lib/auth-http";
import { appOrigin } from "@/lib/auth-utils";
import { eq } from "drizzle-orm";

function redirectTo(request: Request, path: string, setCookie?: string) {
  const headers = new Headers({ Location: `${appOrigin(request)}${path}` });
  if (setCookie) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return redirectTo(request, "/signin?error=invalid_link");

  const payload = await verifyEmailToken(token, "verify");
  if (!payload) return redirectTo(request, "/signin?error=invalid_link");

  const db = getDb();
  const existing = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, payload.uid))
    .limit(1);

  if (!existing[0] || existing[0].email !== payload.email) {
    return redirectTo(request, "/signin?error=invalid_link");
  }

  await db.update(users).set({ emailVerifiedAt: Date.now() }).where(eq(users.id, existing[0].id));
  const { setCookie } = await mintSessionCookie(existing[0], request);
  return redirectTo(request, "/account?verified=1", setCookie);
}

export async function POST(request: Request) {
  let body: { token?: string } = {};
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return Response.json({ error: "This confirmation link is invalid." }, { status: 400 });
  }
  if (!body.token) return Response.json({ error: "This confirmation link is invalid." }, { status: 400 });

  const payload = await verifyEmailToken(body.token, "verify");
  if (!payload) return Response.json({ error: "This confirmation link is invalid or has expired." }, { status: 400 });

  const db = getDb();
  const existing = await db
    .select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users)
    .where(eq(users.id, payload.uid))
    .limit(1);
  if (!existing[0] || existing[0].email !== payload.email) {
    return Response.json({ error: "This confirmation link is invalid." }, { status: 400 });
  }

  await db.update(users).set({ emailVerifiedAt: Date.now() }).where(eq(users.id, existing[0].id));
  const { user, setCookie } = await mintSessionCookie(existing[0], request);
  return Response.json({ user: jsonUser(user) }, { headers: { "Set-Cookie": setCookie } });
}
