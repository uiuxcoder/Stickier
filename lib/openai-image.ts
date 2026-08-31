export type OpenAIImageEditBodyInput = {
  model: string;
  prompt: string;
  quality?: string;
  size?: string;
  background?: "transparent" | "opaque";
  outputFormat?: "png" | "webp" | "jpeg";
  photos: File[];
};

export function buildOpenAIImageEditBody({
  model,
  prompt,
  quality,
  size = "1024x1024",
  background = "opaque",
  outputFormat = "png",
  photos,
}: OpenAIImageEditBodyInput) {
  const body = new FormData();
  body.append("model", model);
  body.append("prompt", prompt);
  body.append("size", size);
  body.append("background", background);
  body.append("output_format", outputFormat);
  if (quality) body.append("quality", quality);
  for (const photo of photos) {
    body.append("image", photo);
  }
  return body;
}
