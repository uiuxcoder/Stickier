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

  const isolationRules =
    "Treat this as a brand-new, standalone request. Only follow details explicitly listed below and visible in the currently provided photos. If a prop, accessory, costume, or style choice is not explicitly requested in this request, do not add it. Never infer carry-over edits from earlier generations (for example, do not add sunglasses unless this request asks for sunglasses).";

  const spacingRules =
    "Treat every cell boundary as a hard clipping-safe boundary. Keep every complete silhouette, white die-cut outline, shadow, body part, hair strand, ear, accessory, and prop well inside one cell. Leave broad, continuous pure-white gutters between every row and column; no artwork may touch or cross a gutter. Keep every sticker inside the middle 70 percent of its row's height, with at least 15 percent of that row blank above and below it. Reserve continuous pure-white horizontal corridors centered at 25 percent, 50 percent, and 75 percent down the canvas, each at least 7.5 percent of the full canvas height. Scale tall or wide poses down rather than cropping them. Never crop a head, face, limb, prop, outline, or shadow at a cell or canvas edge.";

  return `Create exactly one complete premium chibi sticker sheet image, not multiple output images. Arrange exactly ten separate cute sticker illustrations in a clean 3-column by 4-row layout: three rows of three stickers plus one final sticker centered in the middle cell of the fourth row, leaving the two bottom corner cells empty. Treat every position as an equal square cell. Place exactly one complete sticker in the exact center of each occupied cell with equal pure-white margins on all four sides; keep every sticker fully inside its cell and never let any sticker touch a cell edge or another sticker. All ten stickers must depict the same recognizable subject or subjects consistently across the sheet, with matching facial identity, hair, skin tone, and distinctive features; only pose, expression, clothing, and props should vary. Use polished, high-detail chibi character art: heads noticeably larger than the bodies, large luminous expressive eyes with crisp highlights, appealing rounded facial proportions, clean confident ink outlines, carefully layered hair or fur, soft cel shading, subtle dimensional highlights, rich controlled color, tidy hands and anatomy, and charming expressive poses. The finish should resemble a premium professionally illustrated collectible sticker pack, not generic corporate vector art, clip art, emoji art, a coloring-book drawing, or a rough sketch. Apply a tasteful flattering idealization while preserving identity: harmonious facial proportions, bright expressive eyes, clear even skin, refined hair, a warm healthy glow, and camera-ready styling. Keep the person unmistakably recognizable and do not change their age, ethnicity, skin tone, body type, hair identity, or distinctive features. Use only the current request details and the currently provided reference photos. ${isolationRules} ${spacingRules} ${petOnly} Preserve each required subject's recognizable features and include every required subject clearly. Give every sticker a bold, smooth white die-cut border. The entire canvas outside the stickers must be solid pure white (#FFFFFF). Absolutely no cream, tan, gray, or black background pixels anywhere: no horizontal bands at the top, between rows, or at the bottom; no vertical bands; no paper texture, paper borders, frames, headers, footers, dividers, panels, strips, or background shapes; no shadows outside the sticker die-cuts, watermark, unrequested people, or readable text inside the artwork.\n\n${details.join("\n")}`;
}
