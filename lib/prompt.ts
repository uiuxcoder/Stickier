import type { generationRequestSchema } from "@/lib/validation";
import type { z } from "zod";

export type GenerationInput = z.infer<typeof generationRequestSchema>;

export function promptFor(input: GenerationInput): string {
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
