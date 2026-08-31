import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_KEY_PATTERN, UPLOAD_KEY_PATTERN } from "../lib/constants.ts";
import { base64UrlToBytes, bytesToBase64Url, hmacSign, hmacVerify } from "../lib/crypto.ts";
import { isLocalHostname, verifyTurnstile } from "../lib/turnstile.ts";

const SECRET = "test-secret-key-for-unit-tests";

async function signPayload(payload: string) {
  return `${bytesToBase64Url(new TextEncoder().encode(payload))}.${await hmacSign(payload, SECRET)}`;
}

test("base64url round-trips", () => {
  const original = new TextEncoder().encode("hello stickier · session");
  const encoded = bytesToBase64Url(original);
  assert.equal(encoded.includes("+"), false);
  assert.equal(encoded.includes("/"), false);
  assert.deepEqual(Array.from(base64UrlToBytes(encoded)), Array.from(original));
});

test("HMAC sign/verify round-trips", async () => {
  const signature = await hmacSign("payload", SECRET);
  assert.equal(await hmacVerify("payload", signature, SECRET), true);
});

test("HMAC rejects a tampered payload", async () => {
  const signature = await hmacSign("payload", SECRET);
  assert.equal(await hmacVerify("forged-payload", signature, SECRET), false);
});

test("HMAC rejects a wrong secret", async () => {
  const signature = await hmacSign("payload", SECRET);
  assert.equal(await hmacVerify("payload", signature, "different-secret"), false);
});

test("a signed token binds to its exact payload", async () => {
  const token = await signPayload("user-1:exp=9999999999");
  const [body, signature] = token.split(".");
  const payload = new TextDecoder().decode(base64UrlToBytes(body));
  assert.equal(await hmacVerify(payload, signature, SECRET), true);
  // Swapping in a different body must fail verification.
  const other = bytesToBase64Url(new TextEncoder().encode("user-2:exp=9999999999"));
  const otherPayload = new TextDecoder().decode(base64UrlToBytes(other));
  assert.equal(await hmacVerify(otherPayload, signature, SECRET), false);
});

test("upload keys are constrained to the uploads prefix", () => {
  assert.equal(UPLOAD_KEY_PATTERN.test("uploads/11111111-1111-1111-1111-111111111111/abc.png"), true);
  assert.equal(UPLOAD_KEY_PATTERN.test("stickers/11111111-1111-1111-1111-111111111111.png"), false);
  assert.equal(UPLOAD_KEY_PATTERN.test("uploads/../secret.png"), false);
});

test("image keys remain constrained to generated sticker objects", () => {
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/11111111-1111-1111-1111-111111111111.png"), true);
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/../secret.png"), false);
  assert.equal(IMAGE_KEY_PATTERN.test("uploads/11111111-1111-1111-1111-111111111111/abc.png"), false);
});

test("local development hostnames bypass external verification", () => {
  assert.equal(isLocalHostname("localhost"), true);
  assert.equal(isLocalHostname("sticker-era.localhost"), true);
  assert.equal(isLocalHostname("127.0.0.1"), true);
  assert.equal(isLocalHostname("example.com"), false);
  assert.equal(isLocalHostname("localhost.example.com"), false);
});

test("the explicit local development flag bypasses Turnstile", async () => {
  const previousLocalDev = process.env.LOCAL_DEV;
  const previousSecret = process.env.TURNSTILE_SECRET_KEY;
  try {
    process.env.LOCAL_DEV = "1";
    process.env.TURNSTILE_SECRET_KEY = "production-like-secret";
    assert.deepEqual(await verifyTurnstile("invalid-token", undefined, "https://example.com/api"), {
      ok: true,
      reason: "dev-bypass",
    });
  } finally {
    if (previousLocalDev === undefined) delete process.env.LOCAL_DEV;
    else process.env.LOCAL_DEV = previousLocalDev;
    if (previousSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previousSecret;
  }
});
