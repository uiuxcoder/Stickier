import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations, subscriptions } from "@/db/schema";
import {
  CHECKOUT_HOURLY_CAP,
  MONTHLY_PHYSICAL_SHEETS,
  MONTHLY_REGENERATIONS,
  SUBSCRIPTION_AMOUNT_CENTS,
} from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { automaticTaxEnabled, getStripe } from "@/lib/stripe";
import { subscriptionRequestSchema } from "@/lib/validation";
import { and, eq, inArray, gt } from "drizzle-orm";

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) {
    return Response.json({ error: "Create an account or sign in to join Sticker Club." }, { status: 401 });
  }
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Stripe is not configured." }, { status: 500 });

  const activeMembership = await getDb()
    .select({ id: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
    .limit(1);
  if (activeMembership[0]) {
    return Response.json({ error: "Your Sticker Club membership is already active." }, { status: 409 });
  }

  // Check for canceled subscriptions that are still valid (haven't reached period end yet)
  const now = Math.floor(Date.now() / 1000); // Convert to seconds for comparison with currentPeriodEnd
  const pendingCancelation = await getDb()
    .select({ currentPeriodEnd: subscriptions.currentPeriodEnd })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, user.id),
        eq(subscriptions.status, "canceled"),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    )
    .limit(1);

  if (pendingCancelation[0]) {
    const endDate = new Date((pendingCancelation[0].currentPeriodEnd || 0) * 1000);
    const formattedDate = endDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return Response.json(
      { resumable: true, endDate: formattedDate, message: `Your membership is still active through ${formattedDate} and can be resumed.` },
      { status: 409 },
    );
  }

  const hourly = await consumeRateLimit(rateLimiters().checkout, `checkout:${await hashIp(request)}`, CHECKOUT_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  try {
    const parsed = subscriptionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A sticker sheet is required." }, { status: 400 });

    const { subject, imageKey, source } = parsed.data;

    if (imageKey) {
      const generation = await getDb().select().from(generations).where(eq(generations.imageKey, imageKey)).limit(1);
      if (!generation[0]) return Response.json({ error: "That sticker sheet is no longer available." }, { status: 404 });
    }

    const origin = new URL(request.url).origin;
    const enableAutomaticTax = automaticTaxEnabled();
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      ...(enableAutomaticTax ? { automatic_tax: { enabled: true } } : {}),
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Salty Sticker monthly membership",
              description: `${MONTHLY_REGENERATIONS} sticker regenerations + ${MONTHLY_PHYSICAL_SHEETS} physical sticker sheets shipped each month`,
            },
            unit_amount: SUBSCRIPTION_AMOUNT_CENTS,
            recurring: { interval: "month" },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/api/membership/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/membership`,
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata: {
        email: user.email,
        userId: user.id,
        source: source || "membership",
        subject: subject || "Your",
        ...(imageKey ? { imageKey } : {}),
        monthlyRegenerations: String(MONTHLY_REGENERATIONS),
        monthlyPhysicalSheets: String(MONTHLY_PHYSICAL_SHEETS),
      },
      subscription_data: {
        metadata: {
          email: user.email,
          userId: user.id,
          monthlyRegenerations: String(MONTHLY_REGENERATIONS),
          monthlyPhysicalSheets: String(MONTHLY_PHYSICAL_SHEETS),
        },
      },
    });
    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe subscription error", error);
    return Response.json({ error: "Unable to start subscription." }, { status: 500 });
  }
}
