import Link from "next/link";
import { headers } from "next/headers";
import { Check, Download, LockKeyhole, Mail, MapPin } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { JoinStickerClubButton } from "@/components/join-sticker-club-button";

export const dynamic = "force-dynamic";

async function resolveCheckoutEmail(request: Request, sessionId: string | undefined) {
  const user = await getSessionUser(request);
  if (user?.email) return user.email;
  if (!sessionId || !process.env.STRIPE_SECRET_KEY) return null;

  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    return session.customer_details?.email || session.customer_email || null;
  } catch {
    return null;
  }
}

function formatDate(timestampMs: number) {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(amount: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount / 100);
}

export default async function MembershipSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; preview_plan?: string }>;
}) {
  const requestHeaders = await headers();
  const request = new Request("https://membership-success.local", { headers: requestHeaders });
  const params = await searchParams;
  const stripe = process.env.STRIPE_SECRET_KEY ? getStripe() : null;
  const sessionId = params.session_id;

  let email = (await resolveCheckoutEmail(request, sessionId)) || "your email";
  let stickerPreviewUrl = "/sticker-sheet.png";
  let shippingAddress = ["Shipping address provided at checkout"];
  let orderNumber = sessionId
    ? sessionId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()
    : "PENDING";
  let orderDate = formatDate(Date.now());
  let canDownload = false;
  let downloadUrl = "#";
  let purchasedImageKey: string | undefined;
  let subject = "Your";
  let purchasePlan: "digital" | "physical" = "physical";
  let isSubscription = false;
  let productName = "Physical Sticker Sheet";
  let subtotal = 999;
  let tax = 0;
  let total = 999;
  let currency = "usd";

  if (process.env.NODE_ENV !== "production" && params.preview_plan === "digital") {
    purchasePlan = "digital";
    productName = "Digital Sticker Sheet";
    subtotal = 499;
    total = 499;
  }

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 1 });
      const lineItem = lineItems.data[0];

      const imageKey = session.metadata?.imageKey;
      const plan = session.metadata?.plan;
      subject = session.metadata?.subject || subject;
      isSubscription = session.mode === "subscription";
      if (plan === "digital" || plan === "physical") purchasePlan = plan;
      if (imageKey) {
        purchasedImageKey = imageKey;
        stickerPreviewUrl = `/api/preview-stickers?key=${encodeURIComponent(imageKey)}`;
        canDownload = true;
        downloadUrl = `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`;
      }

      const customerEmail = session.customer_details?.email || session.customer_email;
      if (customerEmail) email = customerEmail;

      if (session.created) {
        orderDate = formatDate(session.created * 1000);
      }

      const address = session.customer_details?.address;
      if (address) {
        const lines = [address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(" "), address.country]
          .map((line) => (line || "").trim())
          .filter(Boolean);
        if (lines.length > 0) shippingAddress = lines;
      }

      if (lineItem?.description) productName = lineItem.description;
      else if (isSubscription) productName = "Sticker Club Membership";
      else if (purchasePlan === "digital") productName = "Digital Sticker Sheet";

      currency = session.currency || currency;
      subtotal = session.amount_subtotal ?? lineItem?.amount_subtotal ?? subtotal;
      tax = session.total_details?.amount_tax ?? 0;
      total = session.amount_total ?? lineItem?.amount_total ?? total;
    } catch {
      // Keep graceful fallback copy when Stripe session cannot be loaded.
    }
  }

  const isDigital = purchasePlan === "digital";

  return (
    <main className="order-confirmation-page">
      <header className="order-confirmation-nav">
        <Link href="/" className="order-confirmation-logo">STICKIER<sup>™</sup></Link>
        <span><LockKeyhole size={15} /> Secure checkout</span>
      </header>

      <div className="order-confirmation-layout">
        <section className="order-confirmation-main">
          <div className="order-confirmation-intro">
            <span className="order-confirmation-check"><Check size={28} strokeWidth={2.5} /></span>
            <div>
              <h1>Thank you!</h1>
              <p>{isDigital ? "Your sticker sheet is ready to download." : "Your sticker order is confirmed."}</p>
            </div>
          </div>

          <div className="order-confirmation-meta">
            <strong>Order #{orderNumber}</strong>
            <i aria-hidden="true" />
            <span>{orderDate}</span>
          </div>

          <div className="order-confirmation-actions">
            {canDownload ? (
              <a className="order-confirmation-primary" href={downloadUrl}>
                <Download size={17} /> Download my stickers
              </a>
            ) : (
              <Link className="order-confirmation-primary" href="/account">View my order</Link>
            )}
            <Link href="/?start=upload" className="order-confirmation-secondary">Create another sticker</Link>
          </div>

          {isDigital && !isSubscription ? (
            <aside className="order-confirmation-club">
              <div>
                <small>Make it a monthly thing</small>
                <h2>Sticker Club</h2>
                <strong>$14.99/month</strong>
                <p>Create up to 20 sticker sheets. Get your favorite 3 delivered.</p>
              </div>
              <div className="order-confirmation-club-action">
                <JoinStickerClubButton imageKey={purchasedImageKey} subject={subject} />
                <span>Cancel anytime</span>
              </div>
            </aside>
          ) : null}

          <section className="order-details-section">
            <h2>Order details</h2>
            <div className="order-detail-row">
              <span className="order-detail-icon"><Mail size={20} /></span>
              <div>
                <small>Delivery email</small>
                <p>{email}</p>
              </div>
            </div>
            {!isDigital ? (
              <div className="order-detail-row">
                <span className="order-detail-icon"><MapPin size={22} /></span>
                <div>
                  <small>Shipping address</small>
                  <address>{shippingAddress.map((line) => <span key={line}>{line}</span>)}</address>
                </div>
              </div>
            ) : null}
          </section>
        </section>

        <aside className="order-summary-panel">
          <div className="order-summary-product">
            <img src={stickerPreviewUrl} alt="Purchased custom sticker sheet" />
            <div>
              <strong>{productName}</strong>
              <span>Qty 1</span>
            </div>
            <b>{formatMoney(subtotal, currency)}</b>
          </div>
          <dl className="order-summary-costs">
            <div><dt>Subtotal</dt><dd>{formatMoney(subtotal, currency)}</dd></div>
            <div><dt>Taxes</dt><dd>{formatMoney(tax, currency)}</dd></div>
            <div className="order-summary-total">
              <dt>Total</dt>
              <dd><small>{currency.toUpperCase()}</small>{formatMoney(total, currency)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
