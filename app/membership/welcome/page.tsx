import Link from "next/link";
import { Check, CreditCard, MapPin, Sparkles } from "lucide-react";
import { getStripe, isPaidCheckout } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";

export const dynamic = "force-dynamic";

export default async function MembershipWelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; preview?: string }>;
}) {
  const { session_id: sessionId, preview } = await searchParams;
  let imageUrl: string | null = null;
  let email = "your email";
  let isConfirmed = process.env.NODE_ENV !== "production" && preview === "1";

  if (isConfirmed) imageUrl = "/sticker-sheet.png";

  if (sessionId && process.env.STRIPE_SECRET_KEY) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      isConfirmed = session.mode === "subscription" && isPaidCheckout(session);
      email = session.customer_details?.email || session.customer_email || email;
      if (isImageKey(session.metadata?.imageKey)) {
        imageUrl = `/api/preview-stickers?key=${encodeURIComponent(session.metadata.imageKey)}`;
      }
    } catch {
      isConfirmed = false;
    }
  }

  if (!isConfirmed) {
    return (
      <main className="membership-welcome-page membership-welcome-error">
        <section>
          <h1>We couldn&apos;t confirm that membership.</h1>
          <p>Please return to checkout or contact support if you completed payment.</p>
          <Link href="/membership">Return to Sticker Club</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="membership-welcome-page">
      <header className="membership-welcome-nav">
        <Link href="/">STICKIER<sup>™</sup></Link>
        <span>Sticker Club</span>
      </header>
      <div className="membership-welcome-layout">
        <section className="membership-welcome-copy">
          <span className="membership-welcome-kicker">Membership confirmed</span>
          <div className="membership-welcome-check"><Check size={28} /></div>
          <h1>You&apos;re in the<br />Sticker Club<span>✦</span></h1>
          <p>Your 20 monthly creations and 3 printed sticker sheets are ready. A confirmation was sent to {email}.</p>
          <Link className="membership-welcome-primary" href="/account">Go to membership dashboard</Link>
        </section>
        <section className="membership-welcome-preview">
          {imageUrl ? (
            <div className="membership-welcome-sheet">
              <img src={imageUrl} alt="Your first Sticker Club creation" />
              <span>Your first creation</span>
            </div>
          ) : (
            <div className="membership-welcome-placeholder"><Sparkles size={42} /><span>Your first creation is waiting</span></div>
          )}
          <div className="membership-welcome-benefits">
            <div><Sparkles size={18} /><span><strong>20 creations</strong> every month</span></div>
            <div><MapPin size={18} /><span><strong>3 printed sheets</strong> delivered</span></div>
            <div><CreditCard size={18} /><span><strong>Manage anytime</strong> through Stripe</span></div>
          </div>
        </section>
      </div>
    </main>
  );
}
