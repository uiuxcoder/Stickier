/**
 * PBKDF2-SHA256 password hashing via Web Crypto. Workers-safe, no native
 * addons. The iteration count is stored with the hash so it can be raised later
 * without invalidating existing passwords.
 */
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./constants.ts";
import { base64UrlToBytes, bytesToBase64Url, timingSafeEqual } from "./crypto.ts";

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BYTES = 32;
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein1",
  "welcome1",
  "stickier",
  "stickier1",
]);

export type PasswordIssue = "too-short" | "too-long" | "too-common" | "whitespace-only";

export function passwordIssue(password: string): PasswordIssue | null {
  if (password.length < PASSWORD_MIN_LENGTH) return "too-short";
  if (password.length > PASSWORD_MAX_LENGTH) return "too-long";
  if (password.trim().length === 0) return "whitespace-only";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "too-common";
  return null;
}

export function passwordErrorMessage(issue: PasswordIssue): string {
  switch (issue) {
    case "too-short":
      return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    case "too-long":
      return `Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`;
    case "too-common":
      return "That password is too common. Choose a different one.";
    case "whitespace-only":
      return "Enter a password.";
  }
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    keyMaterial,
    PBKDF2_KEY_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 10_000 || iterations > 10_000_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64UrlToBytes(parts[3]);
    expected = base64UrlToBytes(parts[4]);
  } catch {
    return false;
  }
  if (salt.byteLength < 8 || expected.byteLength < 16) return false;

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

let dummyHash: string | null = null;

/** Run a full verify against a dummy hash so missing users take a similar amount of time. */
export async function verifyPasswordDummy(password: string): Promise<false> {
  if (!dummyHash) dummyHash = await hashPassword("stickier-dummy-password-not-a-real-user");
  await verifyPassword(password, dummyHash);
  return false;
}
