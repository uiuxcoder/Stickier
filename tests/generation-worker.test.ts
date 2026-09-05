import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenAIImageEditBody,
  GENERATION_IMAGE_QUALITY,
  GENERATION_IMAGE_SIZE,
} from "../lib/openai-image.ts";
import { promptFor } from "../lib/prompt.ts";
import { shouldUseTwoPassReferenceFlow } from "../lib/reference-flow.ts";

test("generation uses the economical portrait settings", () => {
  assert.equal(GENERATION_IMAGE_SIZE, "1024x1536");
  assert.equal(GENERATION_IMAGE_QUALITY, "medium");
});

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
  assert.equal(form.getAll("image[]").length, 2);
  assert.equal(form.getAll("image[]")[0]?.name, "one.png");
  assert.equal(form.getAll("image[]")[1]?.name, "two.png");
});

test("animal-only photos stay animals when the default subject label is used", () => {
  const prompt = promptFor({
    photoKeys: [],
    photos: [],
    subject: "You",
    product: "me",
    companion: "skip",
    moods: [],
    specialRequest: "Put it in a gorilla costume.",
  });

  assert.match(prompt, /photos determine the subject's species and identity/i);
  assert.match(prompt, /show only an animal.*no human person, face, hands, or body/i);
  assert.match(prompt, /costume changes clothing only, never the subject's species/i);
});

test("reference photos only guide expression and pose without changing the original face", () => {
  const prompt = promptFor({
    photoKeys: ["reference.png"],
    photos: ["data:image/png;base64,abc123"],
    subject: "You",
    product: "me",
    companion: "skip",
    moods: [],
    specialRequest: "Turn me into this meme.",
  });

  assert.match(prompt, /reference photos? are for expression, pose, and framing only/i);
  assert.match(prompt, /first uploaded customer image is the identity anchor/i);
  assert.match(prompt, /keep the original face shape.*skin tone.*age.*distinctive features/i);
  assert.match(prompt, /do not copy the reference person's facial structure, identity/i);
});

test("meme text enables the two-pass reference flow", () => {
  const input = {
    photoKeys: [],
    photos: [],
    subject: "You",
    product: "me" as const,
    companion: "skip" as const,
    moods: [],
    specialRequest: "Turn me into this MEME",
  };

  assert.equal(shouldUseTwoPassReferenceFlow(input.specialRequest, 1, 1), true);
  assert.equal(shouldUseTwoPassReferenceFlow("Match this pose", 1, 1), false);
  assert.equal(shouldUseTwoPassReferenceFlow(input.specialRequest, 1, 0), false);
});
