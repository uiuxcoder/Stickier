import { buildClearSessionCookie } from "@/lib/auth";
import { appOrigin } from "@/lib/auth-utils";

/**
 * POST only: a GET sign-out can be triggered by any link prefetch or third-party
 * image tag, which logs the visitor out without their intent.
 */
export async function POST(request: Request) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${appOrigin(request)}/`,
      "Set-Cookie": buildClearSessionCookie(request),
    },
  });
}
