/**
 * Image format detection based on file signatures rather than the browser or
 * client supplied MIME type. Phone galleries routinely hand over HEIC bytes
 * under an empty type or a `.jpg` name, and OpenAI's image edits endpoint
 * rejects the request ("Invalid image file or mode for image N") when the
 * declared format does not match the actual bytes.
 */

/** Formats accepted by the OpenAI images edits endpoint. */
export const OPENAI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type OpenAIImageType = (typeof OPENAI_IMAGE_TYPES)[number];

export type DetectedImageType = OpenAIImageType | "image/gif" | "image/heic" | "image/avif";

const EXTENSION_BY_TYPE: Record<DetectedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/avif": "avif",
};

// ISO base media brands that identify a still image in a HEIF container.
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** Longest prefix any signature check needs. */
export const IMAGE_SIGNATURE_BYTES = 32;

function ascii(bytes: Uint8Array, start: number, length: number) {
  let out = "";
  for (let i = start; i < start + length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/**
 * Identify an image from its leading bytes. Returns null when the bytes do not
 * match any format we know how to handle.
 */
export function sniffImageType(input: ArrayBuffer | Uint8Array): DetectedImageType | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";

  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return "image/gif";

  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    if (AVIF_BRANDS.has(brand)) return "image/avif";
    if (HEIF_BRANDS.has(brand)) return "image/heic";
  }

  return null;
}

export function isOpenAIImageType(type: string | null | undefined): type is OpenAIImageType {
  return OPENAI_IMAGE_TYPES.includes(type as OpenAIImageType);
}

/** Header bytes to read before all APP segments of a JPEG have been seen. */
export const JPEG_HEADER_SCAN_BYTES = 512 * 1024;

export type JpegAdvisory = {
  /**
   * True when an APP2 "MPF" (Multi-Picture Format) segment is present. Apple
   * cameras use this to staple an HDR gain map onto the primary image, and
   * OpenAI's decoder rejects the resulting file outright.
   */
  multiPicture: boolean;
  /** EXIF orientation tag; 1 means the pixels are already upright. */
  orientation: number;
};

function readExifOrientation(bytes: Uint8Array, tiffStart: number, end: number): number | null {
  if (tiffStart + 8 > end) return null;

  const littleEndian = ascii(bytes, tiffStart, 2) === "II";
  const u16 = (at: number) =>
    littleEndian ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  const u32 = (at: number) =>
    (littleEndian
      ? bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)
      : (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

  if (u16(tiffStart + 2) !== 0x2a) return null;

  const directory = tiffStart + u32(tiffStart + 4);
  if (directory + 2 > end) return null;

  const entries = u16(directory);
  for (let i = 0; i < entries; i += 1) {
    const entry = directory + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) return u16(entry + 8);
  }
  return null;
}

/**
 * Walk a JPEG's marker segments for traits that make an otherwise valid file
 * unusable downstream. Returns null when the input is not a JPEG.
 */
export function inspectJpeg(input: ArrayBuffer | Uint8Array): JpegAdvisory | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const advisory: JpegAdvisory = { multiPicture: false, orientation: 1 };
  let offset = 2;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];

    // Standalone markers carry no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    // Everything after the start of scan is entropy-coded data.
    if (marker === 0xda) break;

    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) break;
    const payload = offset + 4;
    const segmentEnd = Math.min(offset + 2 + length, bytes.length);

    if (marker === 0xe2 && ascii(bytes, payload, 3) === "MPF") advisory.multiPicture = true;
    if (marker === 0xe1 && ascii(bytes, payload, 4) === "Exif") {
      advisory.orientation = readExifOrientation(bytes, payload + 6, segmentEnd) ?? advisory.orientation;
    }

    offset += 2 + length;
  }

  return advisory;
}

export function extensionForImageType(type: string | null | undefined): string {
  return EXTENSION_BY_TYPE[type as DetectedImageType] ?? "png";
}

/**
 * Build a filename whose extension agrees with the MIME type. The edits
 * endpoint inspects both, so a mismatch fails validation even when the bytes
 * themselves are fine.
 */
export function imageFileName(base: string, type: string | null | undefined): string {
  return `${base}.${extensionForImageType(type)}`;
}
