export const MONTHLY_REGENERATIONS = 20;
export const MONTHLY_PHYSICAL_SHEETS = 3;
export const ONE_TIME_AMOUNT_CENTS = 499;
export const SUBSCRIPTION_AMOUNT_CENTS = 1999;
export const DOWNLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const IMAGE_KEY_PATTERN = /^stickers\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const AUTH_MINUTE_CAP = 10;
export const AUTH_EMAIL_HOURLY_CAP = 10;
export const SIGNUP_HOURLY_CAP = 8;
export const FORGOT_PASSWORD_HOURLY_CAP = 5;
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
export const THEMES = [
  "Classic",
  "Valentine's Day",
  "Halloween",
  "Thanksgiving",
  "Christmas",
  "Birthday",
] as const;
// Keep this list aligned with the client mood picker in `app/page.tsx`.
export const MOODS = ["Cute", "Funny", "Happy", "Cozy", "Angry", "Chaotic"] as const;
export const PRODUCTS = ["me", "pet", "partner", "family"] as const;
export const MAX_REFERENCE_PHOTOS = 6;
// 8MB keeps mobile photos usable in local/prod flows while still bounded.
export const MAX_PHOTO_BYTES = 8_000_000;
export const MAX_SPECIAL_REQUEST_CHARS = 500;
export const ANON_DAILY_PREVIEWS = 2;
export const GENERATE_HOURLY_CAP = 8;
export const CHECKOUT_HOURLY_CAP = 12;
export const DOWNLOAD_HOURLY_CAP = 40;
export const PREVIEW_WIDTH = 640;
export const PREVIEW_QUALITY = 38;
export const UPLOAD_KEY_PATTERN = /^uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-z-]+\.(jpe?g|png|webp)$/i;
