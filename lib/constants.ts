export const MONTHLY_REGENERATIONS = 20;
export const ONE_TIME_AMOUNT_CENTS = 399;
export const SUBSCRIPTION_AMOUNT_CENTS = 999;
export const DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const IMAGE_KEY_PATTERN = /^stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
export const THEMES = [
  "Classic",
  "Valentine's Day",
  "Halloween",
  "Thanksgiving",
  "Christmas",
  "Birthday",
] as const;
export const MOODS = ["Cute", "Funny", "Cozy", "Chaotic", "Dreamy", "Cool", "Sweet", "Playful"] as const;
export const PRODUCTS = ["me", "pet", "partner", "family"] as const;
export const MAX_REFERENCE_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 2_500_000;
export const MAX_SPECIAL_REQUEST_CHARS = 500;
export const ANON_DAILY_PREVIEWS = 2;
export const GENERATE_HOURLY_CAP = 8;
export const CHECKOUT_HOURLY_CAP = 12;
export const DOWNLOAD_HOURLY_CAP = 40;
export const PREVIEW_WIDTH = 640;
export const PREVIEW_QUALITY = 38;
export const UPLOAD_KEY_PATTERN = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-z-]+\.(jpe?g|png|webp)$/i;
