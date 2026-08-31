import Stripe from "stripe";

export function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured.");
  return new Stripe(secret, {
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 1,
    timeout: 10_000,
  });
}

export function automaticTaxEnabled() {
  const secret = process.env.STRIPE_SECRET_KEY;
  return process.env.STRIPE_ENABLE_AUTOMATIC_TAX === "true" && Boolean(secret) && !secret!.startsWith("sk_test_");
}

export function subscriptionIdFromInvoice(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (typeof subscription === "string") return subscription;
  if (subscription && typeof subscription === "object" && "id" in subscription) return subscription.id;
  return null;
}

export function periodEndFromSubscription(subscription: Stripe.Subscription) {
  return subscription.items.data[0]?.current_period_end ?? null;
}

export function customerId(value: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined) {
  if (typeof value === "string") return value;
  if (value && "id" in value) return value.id;
  return null;
}

export function checkoutEmail(session: Stripe.Checkout.Session) {
  return session.customer_details?.email || session.customer_email || session.metadata?.email || null;
}

export function checkoutShippingLines(session: Stripe.Checkout.Session) {
  const shipping = session.collected_information?.shipping_details;
  const address = shipping?.address || session.customer_details?.address;
  if (!address) return [];

  return [
    shipping?.name || session.customer_details?.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(" "),
    address.country,
  ]
    .map((line) => (line || "").trim())
    .filter(Boolean);
}

export function isPaidCheckout(session: Stripe.Checkout.Session) {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}
