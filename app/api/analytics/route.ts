import { ANALYTICS_EVENTS } from "@/lib/analytics-events";

const ALLOWED_EVENTS = new Set<string>(ANALYTICS_EVENTS);

// Every field the client may send. Anything else is dropped so filenames,
// photo URLs, or other photo metadata can never reach the logs, even if a
// future client change regresses.
const STRING_FIELDS = new Set([
  "session_id",
  "ts",
  "path",
  "device_type",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "referrer",
  "landing_variant",
  "cta_placement",
  "plan",
  "source",
]);
const NUMBER_FIELDS = new Set(["number_of_photos", "ms_since_landing_view"]);

const MAX_STRING_LENGTH = 300;
const MAX_BODY_BYTES = 4096;

/**
 * Receives product analytics beacons and re-emits them as structured Workers
 * logs (observability is enabled in wrangler.jsonc). No database write: the
 * funnel is analyzed from logs, and this endpoint must stay cheaper than the
 * thing it measures.
 */
export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(null, { status: 400 });
  }

  const event = typeof body.event === "string" ? body.event : "";
  if (!ALLOWED_EVENTS.has(event)) return new Response(null, { status: 422 });

  const clean: Record<string, string | number> = { event };
  for (const [key, value] of Object.entries(body)) {
    if (STRING_FIELDS.has(key) && typeof value === "string") {
      clean[key] = value.slice(0, MAX_STRING_LENGTH);
    } else if (NUMBER_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      clean[key] = Math.max(0, Math.round(value));
    }
  }

  console.log(JSON.stringify({ stickier_analytics: true, ...clean }));
  return new Response(null, { status: 204 });
}
