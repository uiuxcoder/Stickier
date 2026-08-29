import { hashIp, consumeRateLimit, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { AUTH_MINUTE_CAP } from "@/lib/constants";

export async function enforceAuthRateLimit(request: Request, bucket: string) {
  const ipHash = await hashIp(request);
  const minute = await consumeRateLimit(
    rateLimiters().auth,
    `auth:${bucket}:${ipHash}`,
    AUTH_MINUTE_CAP,
    60 * 1000
  );
  if (!minute.ok) return rateLimitResponse(minute.retryAfterMs);
  return null;
}

export function jsonUser(user: { id: string; email: string; displayName: string }) {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
