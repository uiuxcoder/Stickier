/**
 * Shared analytics event catalog. This module must stay environment-neutral
 * (no "use client", no browser APIs) so both the client tracker and the
 * server-side /api/analytics route can import it.
 */
export const ANALYTICS_EVENTS = [
  "landing_view",
  "upload_clicked",
  "photo_selected",
  "photo_uploaded",
  "onboarding_add_details_step_viewed",
  "onboarding_add_details_step_completed",
  "onboarding_select_mood_step_viewed",
  "onboarding_select_mood_step_completed",
  "generation_started",
  "generation_loading_viewed",
  "generation_completed",
  "sticker_preview_viewed",
  "purchase_options_opened",
  "get_my_stickers_clicked",
  "purchase_option_selected",
  "checkout_clicked",
  "checkout_opened",
  "purchase_completed",
  "subscription_started",
  "photo_upload_failed",
  "generation_failed",
  "purchase_options_closed",
  "membership_drop_submitted",
  "member_sticker_generation_requested",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
