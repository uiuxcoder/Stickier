"use client";

/**
 * Minimal first-party analytics. Events are beaconed to /api/analytics and
 * emitted as structured Workers logs (observability is enabled in
 * wrangler.jsonc), so there is no third-party provider to keep in sync.
 *
 * Privacy rules: never send filenames, photo URLs, image contents, or any
 * photo metadata here. Event and property names are allowlisted server-side.
 */
import { ANALYTICS_EVENTS, type AnalyticsEventName } from "@/lib/analytics-events";

export { ANALYTICS_EVENTS, type AnalyticsEventName };

export type AnalyticsProps = {
  number_of_photos?: number;
  cta_placement?: "hero" | "sticky";
  plan?: string;
  source?: "home" | "hero" | "wizard" | "reference";
};

const SESSION_KEY = "stickier-analytics-session";

let sessionId: string | null = null;
let landingViewAt: number | null = null;
let landingVariant = "v1";
const firedOnce = new Set<string>();

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return (sessionId = existing);
    const created = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, created);
    return (sessionId = created);
  } catch {
    return (sessionId = "anonymous");
  }
}

function attribution() {
  const params = new URLSearchParams(window.location.search);
  return {
    device_type: window.matchMedia("(max-width: 900px)").matches ? "mobile" : "desktop",
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    referrer: document.referrer || undefined,
    landing_variant: landingVariant,
  };
}

export function setLandingVariant(variant: "v1" | "v2") {
  landingVariant = variant;
}

export function track(event: AnalyticsEventName, props: AnalyticsProps = {}) {
  if (typeof window === "undefined") return;
  try {
    if (event === "landing_view") landingViewAt = Date.now();
    const payload = {
      event,
      session_id: getSessionId(),
      ts: new Date().toISOString(),
      path: window.location.pathname,
      ...attribution(),
      ...props,
      // Powers "time from landing_view to photo_selected" without joins.
      ...(landingViewAt !== null && event !== "landing_view"
        ? { ms_since_landing_view: Date.now() - landingViewAt }
        : {}),
    };
    const body = JSON.stringify(payload);
    const beacon = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/analytics", beacon)) return;
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never break the product.
  }
}

/** Fires once per page load; key defaults to the event name. */
export function trackOnce(event: AnalyticsEventName, props: AnalyticsProps = {}, key: string = event) {
  if (firedOnce.has(key)) return;
  firedOnce.add(key);
  track(event, props);
}
