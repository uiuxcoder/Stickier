import { decode as decodePng, encode as encodePng } from "fast-png";
import JSZip from "jszip";

export function downloadArchiveKey(imageKey: string) {
  return imageKey.replace(/^stickers\//, "downloads/").replace(/\.png$/i, ".zip");
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

export function makeSheetTransparent(source: Buffer) {
  const { width, height, rgba } = decodeRgba(source);
  const alreadyTransparent = rgba.some((value, index) => index % 4 === 3 && value < 255);

  if (!alreadyTransparent) {
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index] >= 248 && rgba[index + 1] >= 248 && rgba[index + 2] >= 248) {
        rgba[index + 3] = 0;
      }
    }
  }

  return Buffer.from(encodePng({ width, height, data: rgba, channels: 4, depth: 8 }));
}

export function buildStickerTiles(sheet: Buffer) {
  const { width, height, rgba } = decodeRgba(sheet);
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
      for (let column = 0; column < tileWidth; column++) {
        const sourceIndex = ((y + row) * width + (x + column)) * 4;
        const outputIndex = (row * tileWidth + column) * 4;
        output.set(rgba.subarray(sourceIndex, sourceIndex + 4), outputIndex);
      }
    }
    return {
      name: `sticker-${String(index + 1).padStart(2, "0")}.png`,
      buffer: Buffer.from(encodePng({ width: tileWidth, height: tileHeight, data: output, channels: 4, depth: 8 })),
    };
  });
}

export async function buildDownloadArchive(source: Buffer) {
  const sheet = makeSheetTransparent(source);
  const zip = new JSZip();
  zip.file("full-sheet.png", sheet);
  for (const tile of buildStickerTiles(sheet)) zip.file(tile.name, tile.buffer);
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}