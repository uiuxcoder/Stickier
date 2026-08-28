import { buildClearSessionCookie } from "@/lib/auth";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      "Set-Cookie": buildClearSessionCookie(),
    },
  });
}
