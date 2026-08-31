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
    "Use an invisible 3-column by 4-row grid covering the square canvas. Cell boundaries are at x=33.33%, x=66.67%, y=25%, y=50%, and y=75%. Put exactly one sticker in each of these cells: row 1 columns 1-3, row 2 columns 1-3, row 3 columns 1-3, and row 4 column 2 only. Leave row 4 columns 1 and 3 completely empty pure white. Each sticker, including every subject, prop, white die-cut outline, and shadow, must fit within the centered inner 76% width and 72% height of its own cell. The outer margin of every cell must remain completely blank pure white, creating uninterrupted vertical and horizontal gutters across the entire canvas. A sticker may never enter another cell, share a cell, span two cells, overlap a grid boundary, or place any fragment in a neighboring cell. There must be exactly one self-contained sticker per occupied square and zero stray fragments. Scale a pose down until its whole silhouette fits; never crop a head, face, hair, limb, pet, prop, outline, or shadow.";

  return `Create exactly one complete premium chibi sticker sheet image, not multiple output images. Arrange exactly ten separate cute sticker illustrations in the specified 3-column by 4-row grid. All ten stickers must depict the same recognizable subject or subjects consistently across the sheet, with matching facial identity, hair, skin tone, and distinctive features; only pose, expression, clothing, and props should vary. Match this visual direction: polished hand-drawn chibi character illustration with gently oversized heads, large warm almond-shaped expressive eyes with crisp highlights, softly rounded appealing faces, delicate clean dark linework, long layered strands of hair or individually defined fluffy fur, soft warm cel shading, subtle blush and dimensional highlights, rich natural color, tidy anatomy, cozy lifestyle poses, and a refined premium collectible-sticker finish. Keep proportions charming and cute rather than extremely super-deformed. Avoid generic corporate vector art, thick geometric shapes, flat icon art, clip art, emoji art, plastic 3D rendering, photorealism, coloring-book drawings, and rough sketches. Apply a tasteful flattering idealization while preserving identity: slightly more harmonious facial proportions, bright expressive eyes, clear even skin, refined hair, a warm healthy glow, and camera-ready styling. Keep the person unmistakably recognizable and do not change their age, ethnicity, skin tone, body type, hair identity, or distinctive features. Use only the current request details and the currently provided reference photos. ${isolationRules} ${spacingRules} ${petOnly} Preserve each required subject's recognizable features and include every required subject clearly. Give every sticker a bold, smooth white die-cut border. The entire canvas outside the stickers must be solid pure white (#FFFFFF). Absolutely no cream, tan, gray, or black background pixels anywhere: no horizontal bands at the top, between rows, or at the bottom; no vertical bands; no paper texture, paper borders, frames, headers, footers, dividers, panels, strips, or background shapes; no shadows outside the sticker die-cuts, watermark, unrequested people, or readable text inside the artwork. Before finalizing, verify all ten occupied squares contain exactly one complete sticker and no square contains any piece of a neighboring sticker.\n\n${details.join("\n")}`;
}
