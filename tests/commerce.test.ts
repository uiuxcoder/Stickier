import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_PATTERN, IMAGE_KEY_PATTERN } from "../lib/constants.ts";
import { isPaidCheckout, periodEndFromSubscription, subscriptionIdFromInvoice } from "../lib/stripe.ts";

test("accepts generated sticker object keys only", () => {
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/11111111-1111-1111-1111-111111111111.png"), true);
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/../secret.png"), false);
});

test("requires a simple email shape", () => {
  assert.equal(EMAIL_PATTERN.test("you@example.com"), true);
  assert.equal(EMAIL_PATTERN.test("nope"), false);
});

test("reads Stripe invoice subscription ids from parent details", () => {
  const invoice = {
    parent: { subscription_details: { subscription: "sub_123" } },
  } as Parameters<typeof subscriptionIdFromInvoice>[0];
  assert.equal(subscriptionIdFromInvoice(invoice), "sub_123");
});

test("reads billing period end from subscription items", () => {
  const end = 1_800_000_000;
  const subscription = {
    items: { data: [{ current_period_end: end }] },
  } as Parameters<typeof periodEndFromSubscription>[0];
  assert.equal(periodEndFromSubscription(subscription), end);
});

test("treats paid Stripe checkout sessions as paid", () => {
  assert.equal(isPaidCheckout({ payment_status: "paid" } as Parameters<typeof isPaidCheckout>[0]), true);
  assert.equal(isPaidCheckout({ payment_status: "unpaid" } as Parameters<typeof isPaidCheckout>[0]), false);
});
