import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_PATTERN, IMAGE_KEY_PATTERN } from "../lib/constants.ts";
import { purchaseEmailContent, purchaseEmailKind } from "../lib/purchase-email.ts";
import { automaticTaxEnabled, checkoutShippingLines, isPaidCheckout, periodEndFromSubscription, subscriptionIdFromInvoice } from "../lib/stripe.ts";
import type Stripe from "stripe";

test("automatic tax stays off for Stripe test-mode keys", () => {
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousSetting = process.env.STRIPE_ENABLE_AUTOMATIC_TAX;
  process.env.STRIPE_SECRET_KEY = "sk_test_example";
  process.env.STRIPE_ENABLE_AUTOMATIC_TAX = "true";
  try {
    assert.equal(automaticTaxEnabled(), false);
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    assert.equal(automaticTaxEnabled(), true);
  } finally {
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;
    if (previousSetting === undefined) delete process.env.STRIPE_ENABLE_AUTOMATIC_TAX;
    else process.env.STRIPE_ENABLE_AUTOMATIC_TAX = previousSetting;
  }
});

test("accepts generated sticker object keys only", () => {
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/11111111-1111-1111-1111-111111111111.png"), true);
  assert.equal(IMAGE_KEY_PATTERN.test("stickers/../secret.png"), false);
});

test("requires a simple email shape", () => {
  assert.equal(EMAIL_PATTERN.test("you@example.com"), true);
  assert.equal(EMAIL_PATTERN.test("nope"), false);
});

test("classifies and renders purchase confirmation emails", () => {
  const session = (mode: "payment" | "subscription", metadata: Record<string, string>) =>
    ({ id: "cs_test_123", mode, metadata }) as Stripe.Checkout.Session;

  assert.equal(purchaseEmailKind(session("payment", { plan: "digital", imageKey: "generated/a.png" })), "digital");
  assert.equal(purchaseEmailKind(session("payment", { plan: "physical", imageKey: "generated/a.png" })), "physical");
  assert.equal(purchaseEmailKind(session("subscription", { imageKey: "generated/a.png", source: "purchase-modal" })), "membership-with-stickers");
  assert.equal(purchaseEmailKind(session("subscription", { imageKey: "generated/a.png", source: "digital-success" })), "membership-top-up");
  assert.equal(purchaseEmailKind(session("subscription", {})), "membership-top-up");

  const digital = purchaseEmailContent(session("payment", { plan: "digital" }), "https://saltysticker.com");
  assert.match(digital.html, /cs_test_123/);
  const topUp = purchaseEmailContent(session("subscription", {}), "https://saltysticker.com");
  assert.doesNotMatch(topUp.html, /download-stickers/);
  assert.match(topUp.html, /https:\/\/saltysticker\.com\/account/);
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

test("reads the complete shipping address collected by Stripe Checkout", () => {
  const session = {
    collected_information: {
      shipping_details: {
        name: "Ada Lovelace",
        address: {
          line1: "123 Sticker Lane",
          line2: "Apt 4",
          city: "Brooklyn",
          state: "NY",
          postal_code: "11201",
          country: "US",
        },
      },
    },
    customer_details: {
      name: "Billing Name",
      address: { postal_code: "95133", country: "US" },
    },
  } as Parameters<typeof checkoutShippingLines>[0];

  assert.deepEqual(checkoutShippingLines(session), [
    "Ada Lovelace",
    "123 Sticker Lane",
    "Apt 4",
    "Brooklyn NY 11201",
    "US",
  ]);
});
