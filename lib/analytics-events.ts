/**
 * Shared analytics event catalog. This module must stay environment-neutral
 * (no "use client", no browser APIs) so both the client tracker and the
 * server-side /api/analytics route can import it.
 */
export const ANALYTICS_EVENTS = [
  "landing_view",
  "hero_upload_click",
  "header_upload_click",
  "dropzone_click",
  "photo_selected",
  "upload_started",
  "upload_completed",
  "preview_started",
  "preview_rendered",
  "checkout_started",
  "purchase_completed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
