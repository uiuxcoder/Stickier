import Link from "next/link";
import { headers } from "next/headers";
import { ArrowDown, ArrowRight, Check, Sparkles } from "lucide-react";
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

function formatShortDate(timestampMs: number) {
  return new Date(timestampMs).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function deliveryDateFromNow(baseMs: number) {
  const eta = baseMs + 8 * 24 * 60 * 60 * 1000;
  return formatShortDate(eta);
}

export default async function MembershipSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const requestHeaders = await headers();
  const request = new Request("https://membership-success.local", { headers: requestHeaders });
  const params = await searchParams;
  const stripe = process.env.STRIPE_SECRET_KEY ? getStripe() : null;
  const sessionId = params.session_id;

  let email = (await resolveCheckoutEmail(request, sessionId)) || "your email";
  let stickerPreviewUrl = "/sticker-sheet.png";
  let shippingDestination = "Address typed in Stripe shipping";
  let orderNumber = sessionId
    ? sessionId.replace(/[^a-z0-9]/gi, "").slice(-10).toUpperCase()
    : "Pending";
  let estimatedDelivery = deliveryDateFromNow(Date.now());
  let canDownload = false;
  let downloadUrl = "#";
  let purchasePlan: "digital" | "physical" = "physical";

  if (stripe && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 20 });

      const imageKey = session.metadata?.imageKey;
      const plan = session.metadata?.plan;
      if (plan === "digital" || plan === "physical") purchasePlan = plan;
      if (imageKey) {
        stickerPreviewUrl = `/api/preview-stickers?key=${encodeURIComponent(imageKey)}`;
        canDownload = true;
        downloadUrl = `/api/download-stickers?session_id=${encodeURIComponent(sessionId)}`;
      }

      const customerEmail = session.customer_details?.email || session.customer_email;
      if (customerEmail) email = customerEmail;

      if (session.created) {
        estimatedDelivery = deliveryDateFromNow(session.created * 1000);
      }

      const address = session.customer_details?.address;
      if (address) {
        const lines = [address.line1, address.line2, [address.city, address.state, address.postal_code].filter(Boolean).join(" ")]
          .map((line) => (line || "").trim())
          .filter(Boolean);
        if (lines.length > 0) shippingDestination = lines.join(", ");
      }

      if (session.mode === "payment" && !plan) purchasePlan = "physical";
    } catch {
      // Keep graceful fallback copy when Stripe session cannot be loaded.
    }
  }

  if (purchasePlan === "digital") {
    return (
      <main className="membership-success-shell">
        <section className="membership-success-head">
          <h1>Order confirmed ✦</h1>
          <small>
            Confirmation sent to <strong>{email}</strong>
          </small>
        </section>

        <section className="digital-success-shell">
          <div className="digital-preview-card">
            <img className="digital-sheet-image" src={stickerPreviewUrl} alt="Purchased custom sticker sheet" />
          </div>
          <div className="digital-content-col">
            <h2>Your sticker sheet is ready</h2>
            {canDownload ? (
              <a className="digital-download-btn" href={downloadUrl}>
                Download stickers <ArrowDown size={16} />
              </a>
            ) : (
              <Link className="digital-download-btn" href="/account">
                View my order <ArrowRight size={16} />
              </Link>
            )}
            <Link href="/?start=upload" className="digital-remake-link">
              <Sparkles size={14} /> Make another sticker sheet <ArrowRight size={14} />
            </Link>
            <div className="digital-upsell-card">
              <h3>Make it a monthly thing ✦</h3>
              <p className="digital-upsell-price">$19.99/month</p>
              <p className="digital-upsell-copy">Create up to 20 sticker sheets and get your favorite 3 delivered.</p>
              <ul className="digital-upsell-list">
                <li>
                  <Check size={14} /> 20 new sticker sheets every month
                </li>
                <li>
                  <Check size={14} /> Choose 3 to receive as physical sticker sheets
                </li>
                <li>
                  <Check size={14} /> Delivered to your doorstep
                </li>
                <li>
                  <Check size={14} /> Cancel anytime
                </li>
              </ul>
              <JoinStickerClubButton />
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="membership-success-shell">
      <section className="membership-success-head">
        <h1>Order confirmed ✦</h1>
        <small>Confirmation sent to {email}</small>
      </section>

      <section className="purchase-summary">
        <div className="purchase-preview">
          <img src={stickerPreviewUrl} alt="Purchased custom sticker sheet" />
        </div>
        <div className="purchase-details">
          <h3>Custom Sticker Sheet</h3>
          <dl>
            <div>
              <dt>Quantity</dt>
              <dd>1</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>$9.99</dd>
            </div>
            <div>
              <dt>Shipping to</dt>
              <dd>{shippingDestination}</dd>
            </div>
            <div>
              <dt>Estimated delivery</dt>
              <dd>{estimatedDelivery}</dd>
            </div>
            <div>
              <dt>Order #</dt>
              <dd>{orderNumber}</dd>
            </div>
          </dl>
          {canDownload ? (
            <a className="membership-primary-link" href={downloadUrl}>
              Download my sticker sheet
            </a>
          ) : (
            <Link className="membership-primary-link" href="/account">
              View my order
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
