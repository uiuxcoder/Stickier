import type Stripe from "stripe";
import { Resend } from "resend";
import { printSheetKey } from "./sticker-archive.ts";
import { checkoutShippingLines } from "./stripe.ts";

export type PurchaseEmailKind = "digital" | "physical" | "membership-with-stickers" | "membership-top-up";

export function purchaseEmailKind(session: Stripe.Checkout.Session): PurchaseEmailKind {
  if (session.mode === "subscription") {
    return session.metadata?.source === "purchase-modal" && session.metadata?.imageKey ? "membership-with-stickers" : "membership-top-up";
  }
  return session.metadata?.plan === "physical" ? "physical" : "digital";
}

function fulfillmentOrderType(kind: PurchaseEmailKind) {
  if (kind === "digital") return "Digital only";
  if (kind === "physical") return "Digital + physical";
  if (kind === "membership-with-stickers") return "Salty Sticker Club membership + first sticker sheet";
  return "Salty Sticker Club membership";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

export function purchaseEmailContent(session: Stripe.Checkout.Session, origin: string) {
  const kind = purchaseEmailKind(session);
  const hasDownload = kind !== "membership-top-up";
  const downloadUrl = `${origin}/api/download-stickers?session_id=${encodeURIComponent(session.id)}`;
  const details: Record<PurchaseEmailKind, { subject: string; title: string; message: string; fulfillment: string }> = {
    digital: {
      subject: "Your Salty Sticker purchase is confirmed",
      title: "Your stickers are ready.",
      message: "Thanks for your purchase. Your personalized digital sticker pack is ready to download.",
      fulfillment: "Your download link expires in 7 days.",
    },
    physical: {
      subject: "Your Salty Sticker purchase is confirmed",
      title: "Your order is confirmed.",
      message: "Thanks for your purchase. Your digital stickers are ready now, and your physical stickers are being prepared for shipment.",
      fulfillment: "We will email you again when your physical stickers ship. Your download link expires in 7 days.",
    },
    "membership-with-stickers": {
      subject: "Welcome to the Salty Sticker Club",
      title: "Your membership is active.",
      message: "Your digital stickers are ready now, your physical stickers are being prepared, and your monthly Sticker Club benefits are active.",
      fulfillment: "We will email you again when your physical stickers ship. Your download link expires in 7 days.",
    },
    "membership-top-up": {
      subject: "Your Salty Sticker Club membership is active",
      title: "Your membership is active.",
      message: "Thanks for joining the Sticker Club. Your monthly regenerations and physical sticker benefits are now active.",
      fulfillment: "You can manage your membership and create more stickers from your account.",
    },
  };
  const content = details[kind];
  const action = hasDownload
    ? `<p style="margin:24px 0"><a href="${downloadUrl}" style="display:inline-block;background:#e9362b;color:#fff;text-decoration:none;font:700 13px Arial,sans-serif;padding:14px 18px">DOWNLOAD YOUR STICKERS</a></p>`
    : `<p style="margin:24px 0"><a href="${origin}/account" style="display:inline-block;background:#151515;color:#fff;text-decoration:none;font:700 13px Arial,sans-serif;padding:14px 18px">GO TO YOUR ACCOUNT</a></p>`;

  return {
    subject: content.subject,
    html: `<!doctype html>
<html><body style="margin:0;background:#f5f0e6;font-family:Arial,sans-serif;color:#151515">
  <div style="max-width:520px;margin:32px auto;padding:32px 28px;background:#fffdf8;border:1.5px solid #151515">
    <p style="font-weight:900;font-size:11px;letter-spacing:.16em;margin:0 0 18px">SALTY STICKER&trade;</p>
    <h1 style="font-family:Georgia,serif;font-size:32px;margin:0 0 16px">${content.title}</h1>
    <p style="font-size:16px;line-height:1.55;color:#444">${content.message}</p>
    ${action}
    <p style="font-size:13px;line-height:1.5;color:#666;margin:24px 0 0">${content.fulfillment}</p>
  </div>
</body></html>`,
  };
}

export function fulfillmentEmailContent(session: Stripe.Checkout.Session, email: string, origin: string) {
  const imageKey = session.metadata?.imageKey;
  const fulfillmentDetails = imageKey
    ? `<p>Sticker sheet: ${escapeHtml(printSheetKey(imageKey))}</p><p><a href="${origin}/api/preview-stickers?key=${encodeURIComponent(imageKey)}">View sticker sheet preview</a></p>`
    : "<p>No sticker sheet was selected yet.</p>";
  const shippingAddress = checkoutShippingLines(session);
  const shippingDetails = shippingAddress.length
    ? `<h2>Ship to</h2><p>${shippingAddress.map(escapeHtml).join("<br>")}</p>`
    : "<p>No shipping address was included with this checkout.</p>";
  return {
    subject: `Fulfill Salty Sticker ${purchaseEmailKind(session)} ${session.id}`,
    html: `<h1>New Salty Sticker order</h1><p>Order type: ${fulfillmentOrderType(purchaseEmailKind(session))}</p><p>Customer: ${escapeHtml(email)}</p>${shippingDetails}${fulfillmentDetails}`,
  };
}

export async function sendPurchaseEmail(session: Stripe.Checkout.Session, email: string, origin: string) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    throw new Error("Resend is not configured.");
  }
  const content = purchaseEmailContent(session, origin);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const customer = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: email,
    ...content,
  });
  if (customer.error) throw new Error(customer.error.message);

  const fulfillmentContent = fulfillmentEmailContent(session, email, origin);
  const fulfillment = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: process.env.FULFILLMENT_EMAIL || "stickerstripepayments@gmail.com",
    ...fulfillmentContent,
  });
  if (fulfillment.error) console.error("Fulfillment email failed", session.id, fulfillment.error.message);
}