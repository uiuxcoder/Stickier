import assert from "node:assert/strict";
import test from "node:test";
import { passwordErrorMessage, passwordIssue, hashPassword, verifyPassword } from "../lib/password.ts";
import { normalizeEmail, safeRelativeReturnPath } from "../lib/auth-utils.ts";
import { timingSafeEqual } from "../lib/crypto.ts";

test("normalizes emails for account lookup", () => {
  assert.equal(normalizeEmail("  You@Example.COM "), "you@example.com");
});

test("return_to stays on-site and off auth/api routes", () => {
  assert.equal(safeRelativeReturnPath("/account"), "/account");
  assert.equal(safeRelativeReturnPath("/account?subscription=success"), "/account?subscription=success");
  assert.equal(safeRelativeReturnPath("https://evil.example/"), "/");
  assert.equal(safeRelativeReturnPath("//evil.example"), "/");
  assert.equal(safeRelativeReturnPath("/signin"), "/");
  assert.equal(safeRelativeReturnPath("/api/auth/signout"), "/");
  assert.equal(safeRelativeReturnPath("/signin-with-chatgpt"), "/");
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
  assert.equal(stored.startsWith("pbkdf2$sha256$210000$"), true);
  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-password-battery", stored), false);
  assert.equal(await verifyPassword("correct-horse-battery", "not-a-hash"), false);
});

test("timing-safe compare rejects mismatched lengths and bytes", () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
