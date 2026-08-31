#!/usr/bin/env node
/**
 * Quick local test for sticker generation with the current prompt.
 * Usage: node scripts/test-generation.mjs [image-path]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.STICKER_TEST_URL || "http://127.0.0.1:8788";
const imagePath =
  process.argv[2] ||
  path.join(root, "public/sticker-reference-locked-hero-v12.webp");

function toDataUrl(filePath) {
  const bytes = readFileSync(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "png"
          ? "image/png"
          : "application/octet-stream";
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Using image: ${imagePath}`);
  console.log(`API base: ${baseUrl}`);

  const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
  if (!health.ok) {
    console.error("Health check failed:", health);
    process.exit(1);
  }
  console.log("Health OK");

  const body = {
    photos: [toDataUrl(imagePath)],
    subject: "Test User",
    product: "me",
    companion: "skip",
    theme: "Classic",
    moods: ["Cute", "Happy"],
  };

  console.log("Submitting generation job...");
  const submit = await fetch(`${baseUrl}/api/generate-stickers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const submitData = await submit.json();
  if (!submit.ok) {
    console.error("Generation submit failed:", submit.status, submitData);
    process.exit(1);
  }

  const { jobId } = submitData;
  console.log(`Job queued: ${jobId}`);
  console.log("Polling (usually 2–4 minutes)...");

  const started = Date.now();
  while (true) {
    await sleep(5000);
    const statusRes = await fetch(`${baseUrl}/api/generation-status?jobId=${encodeURIComponent(jobId)}`);
    const status = await statusRes.json();
    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[${elapsed}s] status=${status.status}${status.error ? ` error=${status.error}` : ""}`);

    if (status.status === "succeeded") {
      const previewUrl = `${baseUrl}${status.previewUrl}`;
      console.log("\nGeneration complete!");
      console.log(`Preview: ${previewUrl}`);
      console.log(`Image key: ${status.imageKey}`);
      return;
    }
    if (status.status === "failed") {
      console.error("\nGeneration failed:", status.error || "unknown error");
      process.exit(1);
    }
    if (elapsed > 600) {
      console.error("\nTimed out after 10 minutes");
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
