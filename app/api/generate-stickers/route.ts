import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq, gt, sql } from "drizzle-orm";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";

type GenerationRequest = {
  photos?: string[];
  subject?: string;
  product?: string;
  companion?: string;
  companionName?: string;
  species?: string;
  theme?: string;
  moods?: string[];
  specialRequest?: string;
};

type AssetBucket = { put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> };

function promptFor(input: GenerationRequest) {
  const details = [
    `Subject: ${input.subject || "the person in the reference photos"}`,
    input.product === "pet" && input.species ? `Animal: ${input.species}` : "",
    input.companion && input.companion !== "skip"
      ? `Required companion: a separate ${input.companion === "pet" ? input.species || "pet" : "person"} named ${input.companionName || "the companion"}. Include this companion clearly in multiple stickers. Do not replace or omit the companion.`
      : "",
    input.theme ? `Theme: ${input.theme}` : "",
    input.moods?.length ? `Mood: ${input.moods.join(", ")}` : "",
    input.specialRequest ? `Special request: ${input.specialRequest}` : "",
  ].filter(Boolean);

  const petOnly = input.product === "pet"
    ? "This is a pet-only pack. The subject is the dog in the reference photos. Every sticker must depict that dog; include no humans, human faces, or human bodies."
    : "";
  return `Create exactly one complete sticker sheet image, not multiple output images. Arrange exactly ten separate cute sticker illustrations in a clean 3-column by 4-row layout: three rows of three stickers plus one final sticker centered in the middle cell of the fourth row, leaving the two bottom corner cells empty. Treat every position as an equal square cell. Place exactly one complete sticker in the exact center of each occupied cell with equal pure-white margins on all four sides; keep every sticker fully inside its cell and never let any sticker touch a cell edge or another sticker. All ten stickers must depict the same recognizable subject or subjects consistently across the sheet, with matching facial identity, hair, skin tone, and distinctive features; only pose, expression, clothing, and props should vary. Use a distinctly cartoon, animated sticker style rather than realistic caricature: bold clean outlines, simplified facial features, smooth flat color blocks, minimal skin texture, minimal realistic shading, slightly oversized heads and eyes, rounded hands and limbs, expressive smiles, and playful proportions. Make the result feel like a polished modern animated character sheet with bold white die-cut borders, varied poses and props, and a cohesive hand-drawn style. Give each subject a subtle, tasteful aesthetic polish of about 10 percent through flattering proportions, expressive eyes, refined styling, and appealing light, while keeping their real identity, distinctive features, natural character, and overall appearance clearly recognizable. Do not dramatically alter faces, body shape, age, skin tone, hair, or other identifying features. ${petOnly} Preserve each required subject's recognizable features and include every required subject clearly. The entire canvas outside the stickers must be solid pure white (#FFFFFF). Absolutely no cream or tan pixels anywhere: no horizontal bands at the top, between rows, or at the bottom; no vertical bands; no paper texture, paper borders, frames, headers, footers, dividers, panels, strips, or background shapes; no shadows outside the sticker die-cuts, watermark, unrequested people, or readable text inside the artwork.\n\n${details.join("\n")}`;
}

function dataUrlToFile(dataUrl: string, index: number) {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, encoded] = match;
  return new File([Buffer.from(encoded, "base64")], `reference-${index}.png`, { type: mimeType });
}

function watermarkedPreview(imageUrl: string) {
  const escapedImageUrl = imageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const marks = Array.from({ length: 12 }, (_, index) => {
    const x = index % 3 * 390 - 120;
    const y = Math.floor(index / 3) * 260 + 145;
    return `<text x="${x}" y="${y}">STICKIER · PREVIEW</text>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024"><image href="${escapedImageUrl}" x="0" y="0" width="1024" height="1024" preserveAspectRatio="none"/><g fill="#151515" fill-opacity="0.22" font-family="Arial, sans-serif" font-size="30" font-weight="700" letter-spacing="2" transform="rotate(-18 512 512)">${marks}</g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OpenAI is not configured." }, { status: 500 });
  const bucket = (env as unknown as { STICKER_ASSETS?: AssetBucket }).STICKER_ASSETS;
  if (!bucket) return Response.json({ error: "Image storage is not configured." }, { status: 500 });

  try {
    const user = await getChatGPTUser();
    if (user) {
      const profile = await getDb().select({ regenerationsRemaining: users.regenerationsRemaining }).from(users).where(eq(users.email, user.email)).limit(1);
      if (profile[0] && profile[0].regenerationsRemaining < 1) {
        return Response.json({ error: "Your monthly regenerations are used up." }, { status: 403 });
      }
    }
    const input = (await request.json()) as GenerationRequest;
    const photos = (input.photos ?? []).slice(0, 6).map(dataUrlToFile).filter(Boolean) as File[];
    const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
    const body = new FormData();
    body.append("model", model);
    body.append("prompt", promptFor(input));
    body.append("size", "1024x1024");
    body.append("quality", "medium");
    photos.forEach((photo) => body.append("image[]", photo));

    const response = await fetch(photos.length ? OPENAI_EDITS_URL : OPENAI_IMAGES_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });
    const result = (await response.json()) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
    if (!response.ok) {
      console.error("OpenAI image generation error", result.error?.message);
      return Response.json({ error: result.error?.message || "Image generation failed." }, { status: 502 });
    }

    const image = result.data?.[0];
    if (!image?.b64_json && !image?.url) return Response.json({ error: "OpenAI returned no image." }, { status: 502 });
    const imageUrl = image.url || `data:image/png;base64,${image.b64_json}`;
    const imageResponse = image.url ? await fetch(image.url) : null;
    const imageBytes = imageResponse ? await imageResponse.arrayBuffer() : Uint8Array.from(Buffer.from(image.b64_json!, "base64"));
    const imageKey = `stickers/${crypto.randomUUID()}.png`;
    await bucket.put(imageKey, imageBytes, { httpMetadata: { contentType: "image/png" } });
    if (user) {
      try {
        await getDb().update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} - 1` }).where(eq(users.email, user.email)).where(gt(users.regenerationsRemaining, 0));
      } catch (error) {
        console.error("Regeneration allowance update failed", error);
      }
    }
    return Response.json({ imageUrl: watermarkedPreview(imageUrl), imageKey });
  } catch (error) {
    console.error("Image generation request failed", error);
    return Response.json({ error: "Unable to generate stickers." }, { status: 500 });
  }
}