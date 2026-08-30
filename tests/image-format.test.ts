import assert from "node:assert/strict";
import test from "node:test";

import {
  extensionForImageType,
  imageFileName,
  isOpenAIImageType,
  sniffImageType,
} from "../lib/image-format.ts";

function withHeader(header: number[], length = 32) {
  const bytes = new Uint8Array(length);
  bytes.set(header);
  return bytes;
}

const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

test("detects the formats OpenAI accepts", () => {
  assert.equal(sniffImageType(withHeader([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(
    sniffImageType(withHeader([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")])),
    "image/webp"
  );
});

test("detects HEIC regardless of how the browser labelled it", () => {
  for (const brand of ["heic", "heix", "mif1", "msf1"]) {
    const bytes = withHeader([0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii(brand)]);
    assert.equal(sniffImageType(bytes), "image/heic", brand);
  }
  assert.equal(sniffImageType(withHeader([0, 0, 0, 0x18, ...ascii("ftyp"), ...ascii("avif")])), "image/avif");
});

test("HEIC and GIF are not treated as OpenAI-compatible", () => {
  assert.equal(isOpenAIImageType("image/heic"), false);
  assert.equal(isOpenAIImageType("image/avif"), false);
  assert.equal(isOpenAIImageType("image/gif"), false);
  assert.equal(isOpenAIImageType("image/png"), true);
});

test("unknown and truncated input is rejected rather than guessed", () => {
  assert.equal(sniffImageType(new Uint8Array([1, 2, 3])), null);
  assert.equal(sniffImageType(withHeader(ascii("not an image at all"))), null);
});

test("filenames carry an extension that matches the detected type", () => {
  assert.equal(imageFileName("reference-0", "image/jpeg"), "reference-0.jpg");
  assert.equal(imageFileName("reference-1", "image/webp"), "reference-1.webp");
  assert.equal(extensionForImageType("image/png"), "png");
});
