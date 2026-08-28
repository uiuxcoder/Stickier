import { z } from "zod";
import {
  EMAIL_PATTERN,
  IMAGE_KEY_PATTERN,
  MAX_PHOTO_BYTES,
  MAX_REFERENCE_PHOTOS,
  MAX_SPECIAL_REQUEST_CHARS,
  MOODS,
  PRODUCTS,
  THEMES,
} from "@/lib/constants";

const dataUrlSchema = z
  .string()
  .max(Math.ceil(MAX_PHOTO_BYTES * 1.4) + 64)
  .regex(/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+=*$/i);

export const generationRequestSchema = z.object({
  photos: z.array(dataUrlSchema).max(MAX_REFERENCE_PHOTOS).default([]),
  subject: z.string().trim().min(1).max(80).default("Your"),
  product: z.enum(PRODUCTS).default("me"),
  companion: z.enum(["pet", "person", "skip"]).optional(),
  companionName: z.string().trim().max(80).optional(),
  species: z.string().trim().max(40).optional(),
  theme: z.enum(THEMES).optional(),
  moods: z.array(z.enum(MOODS)).max(MOODS.length).default([]),
  specialRequest: z.string().trim().max(MAX_SPECIAL_REQUEST_CHARS).optional(),
});

export const checkoutRequestSchema = z.object({
  email: z.string().trim().regex(EMAIL_PATTERN),
  subject: z.string().trim().max(80).optional(),
  imageKey: z.string().regex(IMAGE_KEY_PATTERN),
});

export const subscriptionRequestSchema = z.object({
  subject: z.string().trim().max(80).optional(),
  imageKey: z.string().regex(IMAGE_KEY_PATTERN),
});

export function isImageKey(value: string | null | undefined): value is string {
  return Boolean(value && IMAGE_KEY_PATTERN.test(value));
}

export function dataUrlToFile(dataUrl: string, index: number) {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.byteLength > MAX_PHOTO_BYTES) return null;
  return new File([bytes], `reference-${index}.png`, { type: match[1] });
}
