import Link from "next/link";

export const metadata = {
  title: "Refunds — Stickier",
  description: "Refund and cancellation policy for Stickier digital sticker packs and memberships.",
};

export default function RefundsPage() {
  return (
    <main className="legal-page">
      <p><Link href="/">← Stickier</Link></p>
      <h1>Refunds &amp; cancellations</h1>
      <p>Digital sticker packs are delivered immediately after payment. If generation failed or the download is broken, email hello@saltysticker.com and we will refund or regenerate that order.</p>
      <p>Monthly memberships can be cancelled at any time. Access continues through the paid period, then regenerations stop. Cancelled memberships do not automatically refund the current period.</p>
    </main>
  );
}
