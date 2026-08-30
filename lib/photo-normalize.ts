/**
 * Browser-side photo normalisation.
 *
 * iPhone photos arrive as HEIC, which OpenAI's image endpoints cannot read, so
 * they have to be transcoded before upload. Detection is done on the file
 * signature because galleries and drag-and-drop frequently report an empty MIME
 * type, or a `.jpg` name wrapped around HEIC bytes.
 *
 * Re-encoding prefers lossless PNG and only steps down to WebP, then JPEG, when
 * the lossless result would exceed the upload cap. HEIC is itself lossy, so a
 * lossless first pass avoids stacking a second generation of compression
 * artefacts on top of what the camera already produced.
 */

import { MAX_PHOTO_BYTES } from "@/lib/constants";
import {
  IMAGE_SIGNATURE_BYTES,
  imageFileName,
  inspectJpeg,
  isOpenAIImageType,
  JPEG_HEADER_SCAN_BYTES,
  sniffImageType,
  type OpenAIImageType,
} from "@/lib/image-format";

export class UnsupportedPhotoError extends Error {}

// Quality ladder applied only when a lossless encode does not fit the cap.
const LOSSY_ATTEMPTS: { type: OpenAIImageType; quality: number }[] = [
  { type: "image/webp", quality: 0.95 },
  { type: "image/webp", quality: 0.88 },
  { type: "image/jpeg", quality: 0.92 },
  { type: "image/jpeg", quality: 0.85 },
];

const DOWNSCALE_STEPS = [1, 0.8, 0.64, 0.5];

function baseName(file: File) {
  return (file.name.replace(/\.[^.]+$/, "") || "photo").slice(0, 60);
}

async function readHeader(file: File) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, JPEG_HEADER_SCAN_BYTES)).arrayBuffer());
}

async function decodeHeic(file: File): Promise<Blob> {
  // heic2any ships a UMD bundle; take whichever shape the bundler hands back.
  const imported = (await import("heic2any")) as unknown as Record<string, unknown>;
  const convert = (imported.default ?? imported) as
    | ((options: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>)
    | undefined;
  if (typeof convert !== "function") throw new UnsupportedPhotoError("HEIC support failed to load.");
  const converted = await convert({ blob: file, toType: "image/png" });
  return Array.isArray(converted) ? converted[0] : converted;
}

async function toBitmap(file: File, detected: string | null): Promise<ImageBitmap> {
  // Safari decodes HEIC natively; everywhere else this throws and we fall back
  // to the (much heavier) WebAssembly decoder.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (detected !== "image/heic" && detected !== "image/avif") {
      throw new UnsupportedPhotoError("That image could not be read.");
    }
  }
  return createImageBitmap(await decodeHeic(file), { imageOrientation: "from-image" });
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality?: number
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type, quality }).catch(() => null);
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function draw(bitmap: ImageBitmap, scale: number): { canvas: AnyCanvas; pixels: number } {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  let canvas: AnyCanvas;
  if (typeof OffscreenCanvas === "function") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    canvas = element;
  }

  const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context) throw new UnsupportedPhotoError("This browser could not process that image.");
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, pixels: width * height };
}

/**
 * Encode at the highest fidelity that fits under the upload cap. The type is
 * re-derived from the encoded bytes because some browsers quietly emit PNG when
 * asked for a format they cannot encode.
 */
async function encodeBestEffort(bitmap: ImageBitmap): Promise<{ blob: Blob; type: OpenAIImageType }> {
  for (const scale of DOWNSCALE_STEPS) {
    const { canvas, pixels } = draw(bitmap, scale);

    // Photographic PNG lands near two bytes per pixel. Skipping a lossless pass
    // that cannot possibly fit avoids a slow multi-second encode we would throw
    // away anyway.
    const attempts =
      pixels * 2 <= MAX_PHOTO_BYTES
        ? [{ type: "image/png" as const, quality: undefined }, ...LOSSY_ATTEMPTS]
        : LOSSY_ATTEMPTS;

    for (const attempt of attempts) {
      const blob = await canvasToBlob(canvas, attempt.type, attempt.quality);
      if (!blob || blob.size === 0 || blob.size > MAX_PHOTO_BYTES) continue;

      const actual = sniffImageType(await blob.slice(0, IMAGE_SIGNATURE_BYTES).arrayBuffer());
      if (isOpenAIImageType(actual)) return { blob, type: actual };
    }
  }

  throw new UnsupportedPhotoError("That photo could not be converted to a supported format.");
}

/**
 * Return a file that OpenAI can read, with its name, extension and MIME type
 * all agreeing with the underlying bytes. Files that are already usable are
 * passed through untouched apart from a name correction.
 */
export async function normalizePhoto(file: File): Promise<File> {
  const header = await readHeader(file);
  const detected = sniffImageType(header);

  if (isOpenAIImageType(detected) && file.size <= MAX_PHOTO_BYTES) {
    // An Apple HDR JPEG carries a second embedded image, and a rotated photo
    // only looks upright once the EXIF tag is applied. Both survive a byte-for-
    // byte upload and break generation, so those files are re-encoded; anything
    // else is passed through untouched.
    const advisory = detected === "image/jpeg" ? inspectJpeg(header) : null;
    const usable = !advisory || (!advisory.multiPicture && advisory.orientation <= 1);
    if (usable) {
      const name = imageFileName(baseName(file), detected);
      if (file.type === detected && file.name === name) return file;
      return new File([file], name, { type: detected });
    }
  } else if (detected === null && !/\.(heic|heif|avif)$/i.test(file.name)) {
    throw new UnsupportedPhotoError("That file is not an image we can read.");
  }

  const bitmap = await toBitmap(file, detected);
  try {
    const { blob, type } = await encodeBestEffort(bitmap);
    return new File([blob], imageFileName(baseName(file), type), { type });
  } finally {
    bitmap.close?.();
  }
}
