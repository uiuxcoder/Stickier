import assert from "node:assert/strict";
import test from "node:test";
import { decode as decodePng, encode as encodePng } from "fast-png";
import JSZip from "jszip";

import { buildDownloadArchive, buildStickerTiles, downloadArchiveKey } from "../lib/sticker-archive.ts";

test("maps generated sticker images to stored download archives", () => {
  assert.equal(downloadArchiveKey("stickers/example.png"), "downloads/example.zip");
});

test("download archive contains a transparent sheet and ten transparent stickers", async () => {
  const width = 30;
  const height = 40;
  const pixels = new Uint8Array(width * height * 4).fill(255);
  const occupiedCells = [
    [0, 0], [0, 1], [0, 2],
    [1, 0], [1, 1], [1, 2],
    [2, 0], [2, 1], [2, 2],
    [3, 1],
  ];

  for (const [row, column] of occupiedCells) {
    const pixel = ((row * 10 + 5) * width + column * 10 + 5) * 4;
    pixels[pixel] = 30;
    pixels[pixel + 1] = 90;
    pixels[pixel + 2] = 180;
  }

  const source = Buffer.from(encodePng({ width, height, data: pixels, channels: 4, depth: 8 }));
  const archive = await JSZip.loadAsync(await buildDownloadArchive(source));
  const expectedNames = [
    "full-sheet.png",
    ...Array.from({ length: 10 }, (_, index) => `sticker-${String(index + 1).padStart(2, "0")}.png`),
  ];
  assert.deepEqual(Object.keys(archive.files).sort(), expectedNames.sort());

  for (const name of expectedNames) {
    const png = decodePng(await archive.file(name)!.async("nodebuffer"));
    assert.equal(png.channels, 4);
    assert.equal(png.data.some((value, index) => index % 4 === 3 && value === 0), true, `${name} should contain transparency`);
  }
});

test("sticker tiles remove artwork spilling in from a neighboring cell", () => {
  const width = 30;
  const height = 40;
  const pixels = new Uint8Array(width * height * 4);

  for (let y = 2; y <= 7; y++) {
    for (let x = 0; x <= 2; x++) {
      pixels[(y * width + x) * 4 + 3] = 255;
    }
  }
  pixels[(5 * width + 5) * 4 + 3] = 255;

  const source = Buffer.from(encodePng({ width, height, data: pixels, channels: 4, depth: 8 }));
  const first = decodePng(buildStickerTiles(source)[0].buffer);

  assert.equal(first.data[(5 * 10 + 1) * 4 + 3], 0, "edge-connected spill should be transparent");
  assert.equal(first.data[(5 * 10 + 5) * 4 + 3], 255, "centered sticker artwork should remain");
});