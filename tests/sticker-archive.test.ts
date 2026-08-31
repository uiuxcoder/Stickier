import assert from "node:assert/strict";
import test from "node:test";
import { decode as decodePng, encode as encodePng } from "fast-png";
import JSZip from "jszip";

import { buildDownloadArchive, buildStickerTiles, downloadArchiveKey } from "../lib/sticker-archive.ts";

test("maps generated sticker images to stored download archives", () => {
  assert.equal(downloadArchiveKey("stickers/example.png"), "downloads/example.zip");
});

const CELL = 100;
const SHEET_WIDTH = CELL * 3;
const SHEET_HEIGHT = CELL * 4;
const ART = [30, 90, 180] as const;
const OCCUPIED_CELLS = [
  [0, 0], [0, 1], [0, 2],
  [1, 0], [1, 1], [1, 2],
  [2, 0], [2, 1], [2, 2],
  [3, 1],
];

function paint(pixels: Uint8Array, x: number, y: number, colour: readonly number[]) {
  const pixel = (y * SHEET_WIDTH + x) * 4;
  pixels[pixel] = colour[0];
  pixels[pixel + 1] = colour[1];
  pixels[pixel + 2] = colour[2];
  pixels[pixel + 3] = 255;
}

/**
 * A white sheet with a 40x40 sticker centred in each occupied cell. Every
 * sticker has a white 6x6 patch walled in by its own artwork, standing in for
 * white clothing that must survive background removal.
 */
function buildSheetFixture() {
  const pixels = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT * 4).fill(255);

  for (const [row, column] of OCCUPIED_CELLS) {
    for (let y = 30; y < 70; y++) {
      for (let x = 30; x < 70; x++) {
        const insideWhitePatch = x >= 45 && x < 51 && y >= 45 && y < 51;
        paint(pixels, column * CELL + x, row * CELL + y, insideWhitePatch ? [255, 255, 255] : ART);
      }
    }
  }

  return Buffer.from(
    encodePng({ width: SHEET_WIDTH, height: SHEET_HEIGHT, data: pixels, channels: 4, depth: 8 })
  );
}

function tileNames() {
  return Array.from({ length: 10 }, (_, index) => `sticker-${String(index + 1).padStart(2, "0")}.png`);
}

test("download archive contains a transparent sheet and ten stickers", async () => {
  const archive = await JSZip.loadAsync(await buildDownloadArchive(buildSheetFixture()));
  assert.deepEqual(Object.keys(archive.files).sort(), ["full-sheet.png", ...tileNames()].sort());

  const sheet = decodePng(await archive.file("full-sheet.png")!.async("nodebuffer"));
  assert.equal(sheet.width, SHEET_WIDTH);
  assert.equal(sheet.height, SHEET_HEIGHT);
  assert.equal(sheet.data[3], 0, "the sheet corner should be knocked out to transparent");

  for (const name of tileNames()) {
    const tile = decodePng(await archive.file(name)!.async("nodebuffer"));
    assert.equal(tile.channels, 4);
    assert.equal(
      tile.data.some((value, index) => index % 4 === 3 && value === 255),
      true,
      `${name} should contain artwork`
    );
  }
});

test("white inside the artwork survives background removal", async () => {
  const archive = await JSZip.loadAsync(await buildDownloadArchive(buildSheetFixture()));
  const sheet = decodePng(await archive.file("full-sheet.png")!.async("nodebuffer"));

  // The walled-in white patch sits at (48, 48) within the first cell.
  const patch = (48 * SHEET_WIDTH + 48) * 4;
  assert.equal(sheet.data[patch + 3], 255, "enclosed white should stay opaque");
  assert.deepEqual(
    [sheet.data[patch], sheet.data[patch + 1], sheet.data[patch + 2]],
    [255, 255, 255],
    "enclosed white should keep its colour"
  );
});

test("each sticker is trimmed to its artwork and given a white die-cut border", async () => {
  const archive = await JSZip.loadAsync(await buildDownloadArchive(buildSheetFixture()));

  for (const name of tileNames()) {
    const tile = decodePng(await archive.file(name)!.async("nodebuffer"));
    assert.ok(tile.width < CELL && tile.height < CELL, `${name} should be cropped out of its ${CELL}px cell`);
    assert.ok(tile.width > 40 && tile.height > 40, `${name} should keep the artwork plus its border`);

    // Walking in from the edge must cross opaque white before reaching artwork.
    const midRow = Math.floor(tile.height / 2);
    let x = 0;
    while (x < tile.width && tile.data[(midRow * tile.width + x) * 4 + 3] === 0) x++;
    assert.ok(x < tile.width, `${name} should have artwork on its middle row`);
    const edge = (midRow * tile.width + x) * 4;
    assert.deepEqual(
      [tile.data[edge], tile.data[edge + 1], tile.data[edge + 2]],
      [255, 255, 255],
      `${name} should start with a white die-cut border`
    );
  }
});

test("sticker tiles drop artwork spilling in from a neighboring cell", () => {
  const pixels = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT * 4).fill(255);

  // A large intruding block from the neighbour, touching the first cell's left edge.
  for (let y = 10; y < 40; y++) {
    for (let x = 0; x < 12; x++) paint(pixels, x, y, ART);
  }
  // The cell's own, larger sticker.
  for (let y = 45; y < 95; y++) {
    for (let x = 30; x < 80; x++) paint(pixels, x, y, ART);
  }

  const source = Buffer.from(
    encodePng({ width: SHEET_WIDTH, height: SHEET_HEIGHT, data: pixels, channels: 4, depth: 8 })
  );
  const first = decodePng(buildStickerTiles(source)[0].buffer);

  // Keeping the intruder would stretch the crop to the full 100px cell width.
  assert.ok(first.width < 70, "only the cell's own sticker should survive the crop");
  assert.ok(first.width > 50, "the cell's own sticker should be kept intact");
});

test("a prop drawn free of the character is kept", () => {
  const pixels = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT * 4).fill(255);

  // The character.
  for (let y = 30; y < 70; y++) {
    for (let x = 20; x < 60; x++) paint(pixels, x, y, ART);
  }
  // A detached prop inside the same cell, touching no edge.
  for (let y = 40; y < 52; y++) {
    for (let x = 70; x < 82; x++) paint(pixels, x, y, ART);
  }

  const source = Buffer.from(
    encodePng({ width: SHEET_WIDTH, height: SHEET_HEIGHT, data: pixels, channels: 4, depth: 8 })
  );
  const first = decodePng(buildStickerTiles(source)[0].buffer);

  // Dropping the prop would crop at x=60 and leave a tile about 40px wide.
  assert.ok(first.width > 60, "the floating prop should be kept alongside the character");
});

test("a sticker running off its own cell edge is kept", () => {
  const pixels = new Uint8Array(SHEET_WIDTH * SHEET_HEIGHT * 4).fill(255);

  // A single sticker overflowing the left and top edges of its cell. Dropping
  // everything that touches an edge would erase the whole tile.
  for (let y = 0; y < 60; y++) {
    for (let x = 0; x < 60; x++) paint(pixels, x, y, ART);
  }

  const source = Buffer.from(
    encodePng({ width: SHEET_WIDTH, height: SHEET_HEIGHT, data: pixels, channels: 4, depth: 8 })
  );
  const first = decodePng(buildStickerTiles(source)[0].buffer);

  assert.ok(
    first.data.some((value, index) => index % 4 === 3 && value === 255),
    "the sticker should survive even though it reaches the cell edge"
  );
  assert.ok(first.width > 55, "the sticker should be kept at close to its full width");
});
