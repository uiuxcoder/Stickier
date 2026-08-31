import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenAIImageEditBody } from "../lib/openai-image.ts";

test("edit payload uses the current OpenAI multipart field names", () => {
  const form = buildOpenAIImageEditBody({
    model: "gpt-image-1",
    prompt: "Make this a sticker sheet",
    quality: "medium",
    photos: [
      new File(["one"], "one.png", { type: "image/png" }),
      new File(["two"], "two.png", { type: "image/png" }),
    ],
  });

  assert.equal(form.get("model"), "gpt-image-1");
  assert.equal(form.get("prompt"), "Make this a sticker sheet");
  assert.equal(form.get("quality"), "medium");
  assert.equal(form.get("background"), "opaque");
  assert.equal(form.get("output_format"), "png");
  assert.equal(form.getAll("image").length, 2);
  assert.equal(form.getAll("image")[0]?.name, "one.png");
  assert.equal(form.getAll("image")[1]?.name, "two.png");
});
