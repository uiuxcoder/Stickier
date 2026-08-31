import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — Salty Sticker™",
  description: "How Salty Sticker collects, uses, and retains photos, emails, and generated artwork.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <p><Link href="/">← Salty Sticker™</Link></p>
      <h1>Privacy Policy</h1>
      <p>Salty Sticker generates personalized sticker sheets from photos you upload. This page explains what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Photos you upload for sticker generation</li>
        <li>Names, themes, moods, and optional notes you provide</li>
        <li>Email address and password (stored as a one-way hash) when you create an account</li>
        <li>Payment records processed by Stripe</li>
        <li>ChatGPT identity headers if you sign in through OpenAI Sites</li>
      </ul>
      <h2>How we use it</h2>
      <p>Photos and prompt details are sent to OpenAI to generate your sticker sheet. Generated images are stored in Cloudflare R2 so we can fulfill your download. Emails are sent with Resend after a successful payment.</p>
      <h2>Retention</h2>
      <p>Unpaid previews may be deleted after 24 hours. Paid artwork is kept so you can download it again from your account. You can email privacy@saltysticker.com to request deletion of stored photos, generated images, and account records.</p>
      <h2>Processors</h2>
      <p>OpenAI (image generation), Stripe (payments), Resend (email), and Cloudflare (hosting, database, and file storage).</p>
    </main>
  );
}
