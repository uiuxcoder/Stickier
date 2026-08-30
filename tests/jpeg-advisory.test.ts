import assert from "node:assert/strict";
import test from "node:test";

import { inspectJpeg } from "../lib/image-format.ts";

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

/** Assemble a minimal JPEG carrying the given APP segments. */
function jpeg(segments: { marker: number; payload: number[] }[]) {
  const bytes: number[] = [0xff, 0xd8];
  for (const { marker, payload } of segments) {
    const length = payload.length + 2;
    bytes.push(0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload);
  }
  bytes.push(0xff, 0xda, 0x00, 0x02);
  return new Uint8Array(bytes);
}

/** APP1 EXIF payload (little-endian TIFF) with a single orientation entry. */
function exif(orientation: number) {
  return [
    ...ascii("Exif"), 0x00, 0x00,
    ...ascii("II"), 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ];
}

test("a plain JPEG needs no rewrite", () => {
  const advisory = inspectJpeg(jpeg([{ marker: 0xe0, payload: [...ascii("JFIF"), 0x00] }]));
  assert.deepEqual(advisory, { multiPicture: false, orientation: 1 });
});

test("an Apple multi-picture JPEG is flagged", () => {
  const advisory = inspectJpeg(
    jpeg([
      { marker: 0xe0, payload: [...ascii("JFIF"), 0x00] },
      { marker: 0xe1, payload: exif(1) },
      { marker: 0xe2, payload: [...ascii("MPF"), 0x00, 0x49, 0x49] },
    ])
  );
  assert.equal(advisory?.multiPicture, true);
});

test("EXIF orientation is read past a large leading segment", () => {
  const advisory = inspectJpeg(
    jpeg([
      { marker: 0xe0, payload: new Array(4000).fill(0x20) },
      { marker: 0xe1, payload: exif(6) },
    ])
  );
  assert.equal(advisory?.orientation, 6);
  assert.equal(advisory?.multiPicture, false);
});

test("non-JPEG input yields no advisory", () => {
  assert.equal(inspectJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});
