import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { generations, subscriptions, users } from "@/db/schema";
import {
  ANON_DAILY_PREVIEWS,
  GENERATE_HOURLY_CAP,
  IMAGE_KEY_PATTERN,
} from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { dataUrlToFile, generationRequestSchema } from "@/lib/validation";
import { and, eq, gt, inArray, sql } from "drizzle-orm";

const OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations";
const OPENAI_EDITS_URL = "https://api.openai.com/v1/images/edits";
const ACTIVE_STATUSES = ["active", "trialing"] as const;

function promptFor(input: ReturnType<typeof generationRequestSchema.parse>) {
  const details = [
    `Subject: ${input.subject || "the person in the reference photos"}`,
    input.product === "pet" && input.species ? `Animal: ${input.species}` : "",
    input.companion && input.companion !== "skip"
      ? `Required companion: a separate ${input.companion === "pet" ? input.species || "pet" : "person"} named ${input.companionName || "the companion"}. Include this companion clearly in multiple stickers. Do not replace or omit the companion.`
      : "",
    input.theme ? `Theme: ${input.theme}` : "",
    input.moods.length ? `Mood: ${input.moods.join(", ")}` : "",
    input.specialRequest ? `Special request: ${input.specialRequest}` : "",
  ].filter(Boolean);

  const petOnly =
    input.product === "pet"
      ? "This is a pet-only pack. The subject is the dog in the reference photos. Every sticker must depict that dog; include no humans, human faces, or human bodies."
      : "";

  return `Create exactly one complete sticker sheet image, not multiple output images. Arrange exactly ten separate cute sticker illustrations in a clean 3-column by 4-row layout: three rows of three stickers plus one final sticker centered in the middle cell of the fourth row, leaving the two bottom corner cells empty. Treat every position as an equal square cell. Place exactly one complete sticker in the exact center of each occupied cell with equal pure-white margins on all four sides; keep every sticker fully inside its cell and never let any sticker touch a cell edge or another sticker. All ten stickers must depict the same recognizable subject or subjects consistently across the sheet, with matching facial identity, hair, skin tone, and distinctive features; only pose, expression, clothing, and props should vary. Use a distinctly cartoon, animated sticker style rather than realistic caricature: bold clean outlines, simplified facial features, smooth flat color blocks, minimal skin texture, minimal realistic shading, slightly oversized heads and eyes, rounded hands and limbs, expressive smiles, and playful proportions. Make the result feel like a polished modern animated character sheet with bold white die-cut borders, varied poses and props, and a cohesive hand-drawn style. Give each subject a subtle, tasteful aesthetic polish of about 10 percent through flattering proportions, expressive eyes, refined styling, and appealing light, while keeping their real identity, distinctive features, natural character, and overall appearance clearly recognizable. Do not dramatically alter faces, body shape, age, skin tone, hair, or other identifying features. ${petOnly} Preserve each required subject's recognizable features and include every required subject clearly. The entire canvas outside the stickers must be solid pure white (#FFFFFF). Absolutely no cream or tan pixels anywhere: no horizontal bands at the top, between rows, or at the bottom; no vertical bands; no paper texture, paper borders, frames, headers, footers, dividers, panels, strips, or background shapes; no shadows outside the sticker die-cuts, watermark, unrequested people, or readable text inside the artwork.\n\n${details.join("\n")}`;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OpenAI is not configured." }, { status: 500 });
  const bucket = env.STICKER_ASSETS;
  if (!bucket) return Response.json({ error: "Image storage is not configured." }, { status: 500 });

  let reservedEmail: string | null = null;
  try {
    const ipHash = await hashIp(request);
    const hourly = await consumeRateLimit(`generate:${ipHash}`, GENERATE_HOURLY_CAP, 60 * 60 * 1000);
    if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

    const user = await getChatGPTUser();
    const db = getDb();

    if (user) {
      const activeSubscription = await db
          .select({ status: subscriptions.status })
          .from(subscriptions)
          .where(and(eq(subscriptions.email, user.email), inArray(subscriptions.status, [...ACTIVE_STATUSES])))
          .limit(1);

      if (activeSubscription[0]) {
        const updated = await db
          .update(users)
          .set({ regenerationsRemaining: sql`${users.regenerationsRemaining} - 1` })
          .where(and(eq(users.email, user.email), gt(users.regenerationsRemaining, 0)))
          .returning({ remaining: users.regenerationsRemaining });
        if (!updated[0]) {
          return Response.json({ error: "Your monthly regenerations are used up." }, { status: 403 });
        }
        reservedEmail = user.email;
      }
    }

    if (!reservedEmail) {
      const daily = await consumeRateLimit(`preview:${ipHash}`, ANON_DAILY_PREVIEWS, 24 * 60 * 60 * 1000);
      if (!daily.ok) {
        return Response.json(
          { error: "Free preview limit reached. Subscribe for 20 regenerations each month." },
          { status: 429 },
        );
      }
    }

    const parsed = generationRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      if (reservedEmail) {
        await db.update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.email, reservedEmail));
      }
      return Response.json({ error: "Please check your photos and details and try again." }, { status: 400 });
    }

    const input = parsed.data;
    const photos = input.photos.map(dataUrlToFile).filter((file): file is File => Boolean(file));
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
      signal: AbortSignal.timeout(55_000),
    });
    const result = (await response.json()) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
    if (!response.ok || (!result.data?.[0]?.b64_json && !result.data?.[0]?.url)) {
      console.error("OpenAI image generation error", result.error?.message);
      if (reservedEmail) {
        await db.update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.email, reservedEmail));
      }
      return Response.json({ error: "Image generation failed. Please try again." }, { status: 502 });
    }

    const image = result.data[0];
    const imageBytes = image.url
      ? await (await fetch(image.url, { signal: AbortSignal.timeout(20_000) })).arrayBuffer()
      : Uint8Array.from(Buffer.from(image.b64_json!, "base64"));
    const imageKey = `stickers/${crypto.randomUUID()}.png`;
    if (!IMAGE_KEY_PATTERN.test(imageKey)) {
      throw new Error("Generated an invalid image key.");
    }

    await bucket.put(imageKey, imageBytes, { httpMetadata: { contentType: "image/png" } });
    await db.insert(generations).values({
      imageKey,
      email: user?.email ?? null,
      createdAt: Date.now(),
    });

    return Response.json({
      imageKey,
      previewUrl: `/api/preview-stickers?key=${encodeURIComponent(imageKey)}`,
    });
  } catch (error) {
    console.error("Image generation request failed", error);
    if (reservedEmail) {
      await getDb().update(users).set({ regenerationsRemaining: sql`${users.regenerationsRemaining} + 1` }).where(eq(users.email, reservedEmail)).catch(() => undefined);
    }
    return Response.json({ error: "Unable to generate stickers." }, { status: 500 });
  }
}
