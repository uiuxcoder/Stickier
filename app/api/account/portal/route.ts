import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { and, desc, eq, inArray } from "drizzle-orm";

async function resolvePortalConfiguration(origin: string) {
  if (process.env.STRIPE_PORTAL_CONFIGURATION_ID) return process.env.STRIPE_PORTAL_CONFIGURATION_ID;

  const stripe = getStripe();
  const existing = await stripe.billingPortal.configurations.list({ limit: 100 });
  const stickierConfiguration = existing.data.find(
    (configuration) => configuration.active && configuration.metadata?.stickier === "membership",
  );
  if (stickierConfiguration) return stickierConfiguration.id;

  const configuration = await stripe.billingPortal.configurations.create({
    name: "Salty Sticker membership",
    default_return_url: `${origin}/account`,
    business_profile: {
      headline: "Manage your Sticker Club membership",
      privacy_policy_url: `${origin}/privacy`,
      terms_of_service_url: `${origin}/terms`,
    },
    features: {
      customer_update: { enabled: true, allowed_updates: ["shipping", "address", "name"] },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: "at_period_end" },
    },
    metadata: { stickier: "membership" },
  });
  return configuration.id;
}

/**
 * Create a Stripe Customer Portal session so a subscriber can update payment
 * methods, view invoices, and cancel. Requires a signed-in user with a linked
 * Stripe customer.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign in to manage billing." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const action = formData.get("action");
    const db = getDb();
    const [profile, activeSubscription] = await Promise.all([
      db.select({ stripeCustomerId: users.stripeCustomerId }).from(users).where(eq(users.id, user.id)).limit(1),
      db
        .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
    ]);

    const customerId = profile[0]?.stripeCustomerId;
    if (!customerId) {
      return Response.json({ error: "No billing account found." }, { status: 404 });
    }

    const origin = new URL(request.url).origin;
    const returnUrl = `${origin}/account`;
    const configurationId = await resolvePortalConfiguration(origin);
    const subscriptionId = activeSubscription[0]?.stripeSubscriptionId;
    const flowData =
      action === "address"
        ? { type: "customer_update" as const, after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } } }
        : action === "payment"
          ? { type: "payment_method_update" as const, after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } } }
          : action === "cancel" && subscriptionId
            ? {
                type: "subscription_cancel" as const,
                subscription_cancel: { subscription: subscriptionId },
                after_completion: { type: "redirect" as const, redirect: { return_url: returnUrl } },
              }
            : undefined;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      configuration: configurationId,
      ...(flowData ? { flow_data: flowData } : {}),
    });
    return Response.redirect(session.url, 303);
  } catch (error) {
    console.error("Customer Portal error", error);
    return Response.json({ error: "Unable to open billing." }, { status: 500 });
  }
}
