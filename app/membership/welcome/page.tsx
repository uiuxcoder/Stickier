import Link from "next/link";
import { Download, LockKeyhole, Mail, MapPin, PackageCheck, Sparkles } from "lucide-react";
import { SUBSCRIPTION_AMOUNT_CENTS } from "@/lib/constants";
import { checkoutShippingLines, getStripe, isPaidCheckout } from "@/lib/stripe";
import { isImageKey } from "@/lib/validation";

export const dynamic = "force-dynamic";

function formatDate(timestampMs: number) {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(amount: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

export default async function MembershipWelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; preview?: string }>;
}) {
  const { session_id: sessionId, preview } = await searchParams;
  let imageUrl: string | null = null;
  let downloadUrl: string | null = null;
  let email = "your email";
  let shippingAddress = ["Shipping address provided at checkout"];
  let orderNumber = sessionId
    ? sessionId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()
    : "PENDING";
  let orderDate = formatDate(Date.now());
  let subtotal = SUBSCRIPTION_AMOUNT_CENTS;
  let tax = 0;
  let total = SUBSCRIPTION_AMOUNT_CENTS;
  let currency = "usd";
  let isConfirmed = process.env.NODE_ENV !== "production" && preview === "1";

  if (isConfirmed) imageUrl = "/sticker-sheet.png";

  if (sessionId && process.env.STRIPE_SECRET_KEY) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      isConfirmed = session.mode === "subscription" && isPaidCheckout(session);
      email = session.customer_details?.email || session.customer_email || email;
      orderNumber = session.id.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase();
      if (session.created) orderDate = formatDate(session.created * 1000);
      const addressLines = checkoutShippingLines(session);
      if (addressLines.length > 0) shippingAddress = addressLines;
      currency = session.currency || currency;
      subtotal = session.amount_subtotal ?? subtotal;
      tax = session.total_details?.amount_tax ?? 0;
      total = session.amount_total ?? total;
      if (isImageKey(session.metadata?.imageKey)) {
        imageUrl = `/api/preview-stickers?key=${encodeURIComponent(session.metadata.imageKey)}`;
        downloadUrl = `/api/download-stickers?session_id=${encodeURIComponent(session.id)}`;
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
        <Link href="/">SALTY STICKER<sup>™</sup></Link>
        <span><LockKeyhole size={15} /> Secure checkout</span>
      </header>
      <div className="membership-welcome-layout">
        <section className="membership-welcome-copy">
          <span className="membership-welcome-kicker">Membership confirmed</span>
          <h1>You&apos;re in the<br />Sticker Club<span>✦</span></h1>
          <p>Your membership is active, and your first sticker sheet is included in both digital and physical form. Your digital copy is ready, and we&apos;ll print and send your first physical sheet on us. A confirmation was sent to {email}.</p>
          <div className="membership-welcome-actions">
            {downloadUrl ? <a className="membership-welcome-primary" href={downloadUrl}><Download size={16} /> Download digital stickers</a> : null}
            <Link className={downloadUrl ? "membership-welcome-secondary" : "membership-welcome-primary"} href="/account">Go to membership dashboard</Link>
          </div>
          <div className="order-confirmation-meta membership-welcome-meta">
            <strong>Order #{orderNumber}</strong>
            <i aria-hidden="true" />
            <span>{orderDate}</span>
          </div>
          <section className="order-details-section membership-welcome-details">
            <h2>Order details</h2>
            <div className="order-detail-row">
              <span className="order-detail-icon"><Mail size={20} /></span>
              <div><small>Confirmation email</small><p>{email}</p></div>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-icon"><MapPin size={22} /></span>
              <div>
                <small>Shipping address</small>
                <address>{shippingAddress.map((line) => <span key={line}>{line}</span>)}</address>
              </div>
            </div>
          </section>
        </section>
        <section className="membership-welcome-preview">
          <div className="membership-welcome-summary-items">
            <div className="membership-welcome-summary-item">
              <span className="membership-welcome-item-icon"><Sparkles size={24} /></span>
              <div><strong>Sticker Club subscription</strong><span>20 creations + 3 printed sheets monthly</span></div>
              <b>{formatMoney(subtotal, currency)}</b>
            </div>
            <div className="membership-welcome-summary-item">
              {imageUrl ? <img src={imageUrl} alt="Your digital sticker sheet" /> : <span className="membership-welcome-item-icon"><Download size={24} /></span>}
              <div><strong>Digital sticker sheet</strong><span>Included with membership</span></div>
              <b>{formatMoney(0, currency)}</b>
            </div>
            <div className="membership-welcome-summary-item">
              <span className="membership-welcome-item-icon"><PackageCheck size={24} /></span>
              <div><strong>First physical sticker sheet</strong><span>Printed and shipped on us</span></div>
              <b>{formatMoney(0, currency)}</b>
            </div>
          </div>
          <dl className="order-summary-costs membership-welcome-costs">
            <div><dt>Subtotal</dt><dd>{formatMoney(subtotal, currency)}</dd></div>
            <div><dt>Taxes</dt><dd>{formatMoney(tax, currency)}</dd></div>
            <div className="order-summary-total"><dt>Total charged</dt><dd><small>{currency.toUpperCase()}</small>{formatMoney(total, currency)}</dd></div>
          </dl>
          <div className="membership-welcome-benefits">
            <div><Download size={18} /><span><strong>Digital stickers</strong> ready to download</span></div>
            <div><PackageCheck size={18} /><span><strong>First printed sheet</strong> included on us</span></div>
            <div><Sparkles size={18} /><span><strong>Sticker Club active</strong> 20 creations + 3 prints monthly</span></div>
          </div>
        </section>
      </div>
    </main>
  );
}
