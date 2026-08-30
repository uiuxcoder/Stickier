export type OpenAIImageEditBodyInput = {
  model: string;
  prompt: string;
  quality?: string;
  size?: string;
  photos: File[];
};

export function buildOpenAIImageEditBody({
  model,
  prompt,
  quality,
  size = "1024x1024",
  photos,
}: OpenAIImageEditBodyInput) {
  const body = new FormData();
  body.append("model", model);
  body.append("prompt", prompt);
  body.append("size", size);
  if (quality) body.append("quality", quality);
  for (const photo of photos) {
    body.append("image", photo);
  }
  return body;
}
