import { z } from "zod";
import {
  EMAIL_PATTERN,
  IMAGE_KEY_PATTERN,
  MAX_PHOTO_BYTES,
  MAX_REFERENCE_PHOTOS,
  MAX_SPECIAL_REQUEST_CHARS,
  MOODS,
  PASSWORD_MAX_LENGTH,
  PRODUCTS,
  THEMES,
  UPLOAD_KEY_PATTERN,
} from "@/lib/constants";
import { imageFileName, isOpenAIImageType, sniffImageType } from "@/lib/image-format";

const dataUrlSchema = z
  .string()
  .max(Math.ceil(MAX_PHOTO_BYTES * 1.4) + 64)
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+=*$/i);

const uploadKeySchema = z.string().regex(UPLOAD_KEY_PATTERN);

export const generationRequestSchema = z.object({
  // Photos arrive as R2 object keys after a direct upload. A small number of
  // inline data URLs are still accepted for backward compatibility.
  photoKeys: z.array(uploadKeySchema).max(MAX_REFERENCE_PHOTOS).default([]),
  photos: z.array(dataUrlSchema).max(MAX_REFERENCE_PHOTOS).default([]),
  subject: z.string().trim().min(1).max(80).default("Your"),
  product: z.enum(PRODUCTS).default("me"),
  companion: z.enum(["pet", "person", "skip"]).optional(),
  companionName: z.string().trim().max(80).optional(),
  species: z.string().trim().max(40).optional(),
  theme: z.enum(THEMES).optional(),
  moods: z.array(z.enum(MOODS)).max(MOODS.length).default([]),
  specialRequest: z.string().trim().max(MAX_SPECIAL_REQUEST_CHARS).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

const checkoutPlanSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");

  if (normalized === "digital") return "digital";
  if (
    normalized === "physical" ||
    normalized === "physical + digital" ||
    normalized === "digital + physical" ||
    normalized === "physical and digital" ||
    normalized === "digital and physical"
  ) {
    return "physical";
  }

  return value;
}, z.enum(["digital", "physical"]).default("digital"));

export const checkoutRequestSchema = z.object({
  email: z.string().trim().regex(EMAIL_PATTERN).optional(),
  subject: z.string().trim().max(80).optional(),
  imageKey: z.string().regex(IMAGE_KEY_PATTERN),
  plan: checkoutPlanSchema,
  name: z.string().trim().max(120).optional(),
  address: z.string().trim().max(200).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(20).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

export const subscriptionRequestSchema = z.object({
  subject: z.string().trim().max(80).optional(),
  imageKey: z.string().regex(IMAGE_KEY_PATTERN).optional(),
  source: z.string().trim().max(40).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

const emailField = z.string().trim().regex(EMAIL_PATTERN).max(254);
const passwordField = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const turnstileField = z.string().max(2048).optional();

export const signUpRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  fullName: z.string().trim().max(80).optional(),
  turnstileToken: turnstileField,
});

export const signInRequestSchema = z.object({
  email: emailField,
  password: passwordField,
  turnstileToken: turnstileField,
});

export const forgotPasswordRequestSchema = z.object({
  email: emailField,
  turnstileToken: turnstileField,
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(16).max(2048),
  password: passwordField,
  turnstileToken: turnstileField,
});

export const resendVerificationRequestSchema = z.object({
  email: emailField,
  turnstileToken: turnstileField,
});

export function isImageKey(value: string | null | undefined): value is string {
  return Boolean(value && IMAGE_KEY_PATTERN.test(value));
}

export function dataUrlToFile(dataUrl: string, index: number) {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > MAX_PHOTO_BYTES) return null;
  // The declared type in the data URL is only a hint; the bytes decide.
  const type = sniffImageType(bytes);
  if (!isOpenAIImageType(type)) return null;
  return new File([bytes], imageFileName(`reference-${index}`, type), { type });
}
