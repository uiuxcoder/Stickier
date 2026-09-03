import { decode as decodePng, encode as encodePng } from "fast-png";
import JSZip from "jszip";

const WHITE_LEVEL = 248;
const OPAQUE_LEVEL = 16;
// Chamfer 3-4 distance transform: a horizontal/vertical step costs 3, a diagonal 4.
const STEP_ORTHOGONAL = 3;
const STEP_DIAGONAL = 4;
const DISTANCE_CEILING = 0xffff;
// Width of the synthesized die-cut border, as a fraction of the sheet's short edge.
const BORDER_RATIO = 0.0075;
const PRINT_WIDTH = 1200;
const PRINT_HEIGHT = 1800;
const PIXELS_PER_METRE_300_DPI = 11811;

export function downloadArchiveKey(imageKey: string) {
  return imageKey.replace(/^stickers\//, "downloads/print-v2/").replace(/\.png$/i, ".zip");
}

export function legacyDownloadArchiveKey(imageKey: string) {
  return imageKey.replace(/^stickers\//, "downloads/").replace(/\.png$/i, ".zip");
}

export function printSheetKey(imageKey: string) {
  return imageKey.replace(/^stickers\//, "prints/");
}

function decodeRgba(source: Buffer) {
  const decoded = decodePng(source);
  const { width, height, channels, data } = decoded;
  const rgba = new Uint8Array(width * height * 4);

  for (let input = 0, pixel = 0; pixel < width * height; pixel++, input += channels) {
    const red = data[input];
    const green = channels >= 3 ? data[input + 1] : red;
    const blue = channels >= 3 ? data[input + 2] : red;
    const alpha = channels === 2 ? data[input + 1] : channels === 4 ? data[input + 3] : 255;
    const output = pixel * 4;
    rgba[output] = red;
    rgba[output + 1] = green;
    rgba[output + 2] = blue;
    rgba[output + 3] = alpha;
  }

  return { width, height, rgba };
}

function resizeRgba(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source.slice();
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  for (let targetY = 0; targetY < targetHeight; targetY++) {
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (targetY + 0.5) * scaleY - 0.5));
    const top = Math.floor(sourceY);
    const bottom = Math.min(sourceHeight - 1, top + 1);
    const yWeight = sourceY - top;

    for (let targetX = 0; targetX < targetWidth; targetX++) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (targetX + 0.5) * scaleX - 0.5));
      const left = Math.floor(sourceX);
      const right = Math.min(sourceWidth - 1, left + 1);
      const xWeight = sourceX - left;
      const outputOffset = (targetY * targetWidth + targetX) * 4;
      const topLeft = (top * sourceWidth + left) * 4;
      const topRight = (top * sourceWidth + right) * 4;
      const bottomLeft = (bottom * sourceWidth + left) * 4;
      const bottomRight = (bottom * sourceWidth + right) * 4;

      for (let channel = 0; channel < 4; channel++) {
        const upper = source[topLeft + channel] * (1 - xWeight) + source[topRight + channel] * xWeight;
        const lower = source[bottomLeft + channel] * (1 - xWeight) + source[bottomRight + channel] * xWeight;
        output[outputOffset + channel] = Math.round(upper * (1 - yWeight) + lower * yWeight);
      }
    }
  }

  return output;
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function add300DpiMetadata(png: Uint8Array) {
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, PIXELS_PER_METRE_300_DPI);
  view.setUint32(12, PIXELS_PER_METRE_300_DPI);
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.subarray(4, 17)));

  const insertionPoint = 8 + 4 + 4 + 13 + 4;
  const output = new Uint8Array(png.length + chunk.length);
  output.set(png.subarray(0, insertionPoint));
  output.set(chunk, insertionPoint);
  output.set(png.subarray(insertionPoint), insertionPoint + chunk.length);
  return output;
}

/**
 * Clear only the white that is reachable from the edge of the sheet. A plain
 * threshold would also erase white *inside* the artwork - a white sweater, a
 * sock, an eye highlight - because those pixels are just as white as the paper.
 * The bold dark outline the prompt asks for is what stops the fill at each
 * sticker's silhouette.
 */
function clearBackground(rgba: Uint8Array, width: number, height: number) {
  const alreadyTransparent = rgba.some((value, index) => index % 4 === 3 && value < 255);
  if (alreadyTransparent) return;

  // Clearing a pixel's alpha also marks it visited, and the fill walks whole
  // scanlines at a time, so the stack only ever holds one entry per run of
  // background rather than one per pixel. A per-pixel queue would be tens of
  // megabytes on a print-resolution sheet.
  const isBackground = (pixel: number) => {
    const offset = pixel * 4;
    return (
      rgba[offset + 3] !== 0 &&
      rgba[offset] >= WHITE_LEVEL &&
      rgba[offset + 1] >= WHITE_LEVEL &&
      rgba[offset + 2] >= WHITE_LEVEL
    );
  };

  const stack: number[] = [];
  const seed = (x: number, y: number) => {
    if (isBackground(y * width + x)) stack.push(x, y);
  };

  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }

  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * width;
    if (!isBackground(row + x)) continue;

    let left = x;
    while (left > 0 && isBackground(row + left - 1)) left--;
    let right = x;
    while (right + 1 < width && isBackground(row + right + 1)) right++;
    for (let pixel = row + left; pixel <= row + right; pixel++) rgba[pixel * 4 + 3] = 0;

    for (const neighbourRow of [y - 1, y + 1]) {
      if (neighbourRow < 0 || neighbourRow >= height) continue;
      const offset = neighbourRow * width;
      let cursor = left;
      while (cursor <= right) {
        while (cursor <= right && !isBackground(offset + cursor)) cursor++;
        if (cursor > right) break;
        stack.push(cursor, neighbourRow);
        while (cursor <= right && isBackground(offset + cursor)) cursor++;
      }
    }
  }
}

/**
 * Two-pass chamfer distance transform giving each transparent pixel its
 * approximate distance to the nearest opaque pixel, in thirds of a pixel.
 */
function distanceToArtwork(rgba: Uint8Array, width: number, height: number) {
  const distance = new Uint16Array(width * height);

  for (let pixel = 0; pixel < distance.length; pixel++) {
    distance[pixel] = rgba[pixel * 4 + 3] > OPAQUE_LEVEL ? 0 : DISTANCE_CEILING;
  }

  const relax = (pixel: number, neighbour: number, weight: number) => {
    const candidate = distance[neighbour] + weight;
    if (candidate < distance[pixel]) distance[pixel] = candidate;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      if (distance[pixel] === 0) continue;
      if (y > 0) relax(pixel, pixel - width, STEP_ORTHOGONAL);
      if (x > 0) relax(pixel, pixel - 1, STEP_ORTHOGONAL);
      if (y > 0 && x > 0) relax(pixel, pixel - width - 1, STEP_DIAGONAL);
      if (y > 0 && x + 1 < width) relax(pixel, pixel - width + 1, STEP_DIAGONAL);
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const pixel = y * width + x;
      if (distance[pixel] === 0) continue;
      if (y + 1 < height) relax(pixel, pixel + width, STEP_ORTHOGONAL);
      if (x + 1 < width) relax(pixel, pixel + 1, STEP_ORTHOGONAL);
      if (y + 1 < height && x + 1 < width) relax(pixel, pixel + width + 1, STEP_DIAGONAL);
      if (y + 1 < height && x > 0) relax(pixel, pixel + width - 1, STEP_DIAGONAL);
    }
  }

  return distance;
}

/**
 * Rebuild the white die-cut border by dilating the artwork. The model's own
 * border cannot survive background removal, because it is the same white as the
 * paper it sits on and is connected to it. Synthesizing the border instead makes
 * it perfectly even on every sticker.
 */
function addDieCutBorder(rgba: Uint8Array, width: number, height: number, radius: number) {
  if (radius <= 0) return;
  const limit = radius * STEP_ORTHOGONAL;
  const distance = distanceToArtwork(rgba, width, height);

  for (let pixel = 0; pixel < distance.length; pixel++) {
    const spread = distance[pixel];
    if (spread === 0 || spread > limit) continue;
    const offset = pixel * 4;
    rgba[offset] = 255;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 255;
    rgba[offset + 3] = 255;
  }
}

/**
 * Drop artwork that bled in from a neighbouring cell. An intruding sliver has to
 * cross this cell's edge to get here, while a prop drawn free of the character
 * sits wholly inside it. So keep the sticker itself - the largest run - plus any
 * interior run big enough not to be resampling speckle, and discard anything
 * else that reaches an edge. Keying on the edge rather than size alone means a
 * sticker that merely overflows its own cell is never deleted outright.
 */
function removeIntrudingArtwork(pixels: Uint8Array, width: number, height: number) {
  const total = width * height;
  const label = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];

  for (let start = 0; start < total; start++) {
    if (label[start] !== -1 || pixels[start * 4 + 3] <= OPAQUE_LEVEL) continue;

    const current = sizes.length;
    let head = 0;
    let tail = 0;
    let edge = false;
    label[start] = current;
    queue[tail++] = start;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = (pixel - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edge = true;

      const visit = (neighbour: number) => {
        if (label[neighbour] !== -1 || pixels[neighbour * 4 + 3] <= OPAQUE_LEVEL) return;
        label[neighbour] = current;
        queue[tail++] = neighbour;
      };

      if (x > 0) visit(pixel - 1);
      if (x + 1 < width) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y + 1 < height) visit(pixel + width);
    }

    sizes.push(tail);
    touchesEdge.push(edge);
  }

  if (sizes.length <= 1) return;

  let largest = 0;
  for (let index = 1; index < sizes.length; index++) {
    if (sizes[index] > sizes[largest]) largest = index;
  }

  const minInteriorSize = Math.max(8, sizes[largest] * 0.005);
  const kept = sizes.map(
    (size, index) => index === largest || (!touchesEdge[index] && size >= minInteriorSize)
  );

  for (let pixel = 0; pixel < total; pixel++) {
    const component = label[pixel];
    if (component !== -1 && !kept[component]) pixels[pixel * 4 + 3] = 0;
  }
}

/**
 * Crop a tile to its artwork so the sticker fills its own file. The art only
 * occupies the middle of its grid cell, so keeping the blank margin would make
 * the sticker print smaller than the file's dimensions suggest.
 */
function trimToArtwork(pixels: Uint8Array, width: number, height: number, padding: number) {
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] <= OPAQUE_LEVEL) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  if (right < left || bottom < top) return { width, height, pixels };

  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(width - 1, right + padding);
  bottom = Math.min(height - 1, bottom + padding);

  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const cropped = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const sourceStart = ((top + y) * width + left) * 4;
    cropped.set(pixels.subarray(sourceStart, sourceStart + cropWidth * 4), y * cropWidth * 4);
  }

  return { width: cropWidth, height: cropHeight, pixels: cropped };
}

/**
 * Add transparent padding around a sticker image for downloads.
 * Keeps the downloaded sticker's transparent background intact.
 */
function addTransparentPadding(pixels: Uint8Array, width: number, height: number, paddingPixels: number) {
  if (paddingPixels <= 0) return { width, height, pixels };

  const paddedWidth = width + (paddingPixels * 2);
  const paddedHeight = height + (paddingPixels * 2);
  const padded = new Uint8Array(paddedWidth * paddedHeight * 4);

  // Copy the original image into the center
  for (let y = 0; y < height; y++) {
    const sourceStart = y * width * 4;
    const destStart = ((y + paddingPixels) * paddedWidth + paddingPixels) * 4;
    padded.set(pixels.subarray(sourceStart, sourceStart + width * 4), destStart);
  }
  
  return { width: paddedWidth, height: paddedHeight, pixels: padded };
}

function borderRadiusFor(width: number, height: number) {
  return Math.round(Math.min(width, height) * BORDER_RATIO);
}

export function makeSheetTransparent(source: Buffer) {
  const { width, height, rgba } = decodeRgba(source);
  clearBackground(rgba, width, height);
  addDieCutBorder(rgba, width, height, borderRadiusFor(width, height));
  return Buffer.from(encodePng({ width, height, data: rgba, channels: 4, depth: 8 }));
}

function tilesFromRgba(width: number, height: number, rgba: Uint8Array, borderRadius: number) {
  const tileWidth = Math.max(1, Math.floor(width / 3));
  const tileHeight = Math.max(1, Math.floor(height / 4));
  const cells = [
    { row: 0, col: 0 },
    { row: 0, col: 1 },
    { row: 0, col: 2 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 1 },
    { row: 2, col: 2 },
    { row: 3, col: 1 },
  ];

  return cells.map((cell, index) => {
    const x = Math.min(width - tileWidth, cell.col * tileWidth);
    const y = Math.min(height - tileHeight, cell.row * tileHeight);
    const output = new Uint8Array(tileWidth * tileHeight * 4);

    for (let row = 0; row < tileHeight; row++) {
      const sourceStart = ((y + row) * width + x) * 4;
      output.set(rgba.subarray(sourceStart, sourceStart + tileWidth * 4), row * tileWidth * 4);
    }

    // Each tile gets its own border after it has been isolated, so a neighbour's
    // border can never dilate across the gutter into this sticker's file.
    removeIntrudingArtwork(output, tileWidth, tileHeight);
    const trimmed = trimToArtwork(output, tileWidth, tileHeight, borderRadius + 2);
    addDieCutBorder(trimmed.pixels, trimmed.width, trimmed.height, borderRadius);
    
    // Add transparent padding around the sticker for downloads.
    const padded = addTransparentPadding(trimmed.pixels, trimmed.width, trimmed.height, 5);

    return {
      name: `sticker-${String(index + 1).padStart(2, "0")}.png`,
      buffer: Buffer.from(
        encodePng({ width: padded.width, height: padded.height, data: padded.pixels, channels: 4, depth: 8 })
      ),
    };
  });
}

export function buildStickerTiles(sheet: Buffer) {
  const { width, height, rgba } = decodeRgba(sheet);
  clearBackground(rgba, width, height);
  return tilesFromRgba(width, height, rgba, borderRadiusFor(width, height));
}

/**
 * Decodes the sheet once and reuses the same pixel buffer for the full sheet and
 * every tile. Print-resolution sheets are several megapixels, so a second decode
 * would risk the Worker memory limit.
 */
export async function buildPrintAssets(source: Buffer) {
  const decoded = decodeRgba(source);
  const width = PRINT_WIDTH;
  const height = PRINT_HEIGHT;
  const rgba = resizeRgba(decoded.rgba, decoded.width, decoded.height, width, height);
  clearBackground(rgba, width, height);
  const borderRadius = borderRadiusFor(width, height);

  const zip = new JSZip();
  // Tiles are cut before the sheet is dilated so each one borders itself.
  for (const tile of tilesFromRgba(width, height, rgba, borderRadius)) zip.file(tile.name, tile.buffer);

  addDieCutBorder(rgba, width, height, borderRadius);
  const printSheet = Buffer.from(add300DpiMetadata(encodePng({ width, height, data: rgba, channels: 4, depth: 8 })));
  zip.file("full-sheet.png", printSheet);
  // The entries are already-compressed PNGs, so deflating again costs Worker CPU
  // for almost no size gain.
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return { archive, printSheet };
}

export async function buildDownloadArchive(source: Buffer) {
  return (await buildPrintAssets(source)).archive;
}
