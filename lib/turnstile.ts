const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token. When no secret is configured (local
 * development), verification is skipped so the app remains usable; in
 * production the secret must be set or every protected action is rejected.
 */
export async function verifyTurnstile(token: string | null | undefined, remoteIp?: string, requestUrl?: string) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const hostname = requestUrl ? new URL(requestUrl).hostname : "";
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "terminal.local";
  if (isLocalHost || (process.env.NODE_ENV !== "production" && (!secret || !token))) {
    return { ok: true, reason: "dev-bypass" };
  }
  if (!secret) {
    return { ok: false, reason: "unconfigured" };
  }
  if (!token) return { ok: false, reason: "missing-token" };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    return result.success
      ? { ok: true }
      : { ok: false, reason: (result["error-codes"] ?? ["invalid"]).join(",") };
  } catch (error) {
    console.error("Turnstile verification error", error);
    return { ok: false, reason: "verify-failed" };
  }
}
