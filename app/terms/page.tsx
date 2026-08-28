import Link from "next/link";

export const metadata = {
  title: "Terms of Service — Stickier",
  description: "Terms for using Stickier digital sticker generation and memberships.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <p><Link href="/">← Stickier</Link></p>
      <h1>Terms of Service</h1>
      <p>By using Stickier you agree to these terms. Stickier sells digital sticker sheets generated from photos you provide.</p>
      <h2>Your content</h2>
      <p>You must have the right to use every photo you upload, including photos of other people. Do not upload images of minors without appropriate consent. You grant Stickier a limited license to process those photos solely to generate and deliver your stickers.</p>
      <h2>The product</h2>
      <p>Results are AI-generated and may vary. Previews are watermarked or reduced-quality. The print-quality file is delivered after payment. Membership includes 20 regenerations per billing period and does not guarantee a specific likeness.</p>
      <h2>Payments</h2>
      <p>One-time packs and monthly memberships are billed by Stripe. Memberships renew until cancelled. See the <a href="/refunds">refund policy</a> for refunds and cancellations.</p>
    </main>
  );
}
