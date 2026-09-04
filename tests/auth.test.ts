import assert from "node:assert/strict";
import test from "node:test";
import { passwordErrorMessage, passwordIssue, hashPassword, verifyPassword } from "../lib/password.ts";
import { normalizeEmail, safeRelativeReturnPath } from "../lib/auth-utils.ts";
import { timingSafeEqual } from "../lib/crypto.ts";
import { createGoogleOAuthState, googleOAuthCookie, googleOAuthOrigin, verifyGoogleOAuthState } from "../lib/google-oauth.ts";

test("normalizes emails for account lookup", () => {
  assert.equal(normalizeEmail("  You@Example.COM "), "you@example.com");
});

test("return_to stays on-site and off auth/api routes", () => {
  assert.equal(safeRelativeReturnPath("/account"), "/account");
  assert.equal(safeRelativeReturnPath("/account?subscription=success"), "/account?subscription=success");
  assert.equal(safeRelativeReturnPath("/membership/checkout?source=purchase-modal"), "/membership/checkout?source=purchase-modal");
  assert.equal(safeRelativeReturnPath("https://evil.example/"), "/");
  assert.equal(safeRelativeReturnPath("//evil.example"), "/");
  assert.equal(safeRelativeReturnPath("/signin"), "/");
  assert.equal(safeRelativeReturnPath("/api/auth/signout"), "/");
  assert.equal(safeRelativeReturnPath("/signin-with-chatgpt"), "/");
});

test("Google OAuth state binds a safe return path and rejects tampering", async () => {
  const now = 1_800_000_000_000;
  const state = await createGoogleOAuthState("/membership/checkout?source=purchase-modal", "test-secret", now);
  assert.equal((await verifyGoogleOAuthState(state, "test-secret", now))?.returnTo, "/membership/checkout?source=purchase-modal");
  assert.equal(await verifyGoogleOAuthState(`${state}x`, "test-secret", now), null);
  assert.equal(await verifyGoogleOAuthState(state, "test-secret", now + 11 * 60 * 1000), null);

  const unsafe = await createGoogleOAuthState("https://evil.example", "test-secret", now);
  assert.equal((await verifyGoogleOAuthState(unsafe, "test-secret", now))?.returnTo, "/");
});

test("Google OAuth uses the browser-facing local development origin", () => {
  const previousOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://localhost:8788";
  try {
    const request = new Request("https://localhost:8788/api/auth/google");
    assert.equal(googleOAuthOrigin(request), "http://localhost:5173");
    assert.equal(googleOAuthCookie("state", request).includes("; Secure"), false);
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  }
});

test("Google OAuth keeps recent states for overlapping sign-in attempts", async () => {
  const request = new Request("https://saltysticker.com/api/auth/google");
  const first = await createGoogleOAuthState("/account", "test-secret", 1_800_000_000_000);
  const second = await createGoogleOAuthState("/account", "test-secret", 1_800_000_000_001);
  const firstCookie = googleOAuthCookie(first, request);
  const cookieValue = firstCookie.split(";")[0].split("=").slice(1).join("=");
  const secondCookie = googleOAuthCookie(second, request, decodeURIComponent(cookieValue));
  assert.match(secondCookie, new RegExp(`${encodeURIComponent(second)}%2C${encodeURIComponent(first)}`));
});

test("rejects weak passwords", () => {
  assert.equal(passwordIssue("short"), "too-short");
  assert.equal(passwordIssue("password"), "too-common");
  assert.equal(passwordIssue("a".repeat(200)), "too-long");
  assert.equal(passwordIssue("correct horse battery"), null);
  assert.match(passwordErrorMessage("too-short"), /8/);
});

test("password hashes verify and reject a wrong password", async () => {
  const stored = await hashPassword("correct-horse-battery");
  assert.equal(stored.startsWith("pbkdf2$sha256$100000$"), true);
  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-password-battery", stored), false);
  assert.equal(await verifyPassword("correct-horse-battery", "not-a-hash"), false);
});

test("timing-safe compare rejects mismatched lengths and bytes", () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
