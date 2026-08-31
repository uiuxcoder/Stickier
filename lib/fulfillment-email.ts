import { Resend } from "resend";

type DropNotification = {
  customerEmail: string;
  monthLabel: string;
  stickerIds: string[];
  shippingAddress: string[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

export async function sendDropSubmittedEmails(notification: DropNotification) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false as const, error: "Email is not configured." };

  const resend = new Resend(apiKey);
  const address = notification.shippingAddress.map(escapeHtml).join("<br>");
  const stickers = notification.stickerIds.map((id) => `<li>${escapeHtml(id)}</li>`).join("");
  const fulfillmentEmail = process.env.FULFILLMENT_EMAIL || "support@saltysticker.com";
  const [customer, fulfillment] = await Promise.all([
    resend.emails.send({
      from,
      to: notification.customerEmail,
      subject: `${notification.monthLabel} Sticker Club order received`,
      html: `<h1>Your monthly stickers are submitted.</h1><p>We received your three selections and will email you when they ship.</p><p>${address}</p>`,
    }),
    resend.emails.send({
      from,
      to: fulfillmentEmail,
      subject: `Fulfill ${notification.monthLabel} Sticker Club drop`,
      html: `<h1>New Sticker Club drop</h1><p>Customer: ${escapeHtml(notification.customerEmail)}</p><p>${address}</p><ol>${stickers}</ol>`,
    }),
  ]);
  const error = customer.error?.message || fulfillment.error?.message;
  if (error) return { ok: false as const, error };
  return { ok: true as const };
}