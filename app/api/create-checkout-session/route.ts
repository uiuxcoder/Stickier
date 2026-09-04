import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { CHECKOUT_HOURLY_CAP, ONE_TIME_AMOUNT_CENTS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { automaticTaxEnabled, getStripe } from "@/lib/stripe";
import { checkoutRequestSchema } from "@/lib/validation";
import { isLocalHostname } from "@/lib/turnstile";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const isLocalDev = isLocalHostname(new URL(request.url).hostname);
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  const hourly = await consumeRateLimit(rateLimiters().checkout, `checkout:${await hashIp(request)}`, CHECKOUT_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  try {
    const parsed = checkoutRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A sticker sheet is required." }, { status: 400 });

    const { email, subject, imageKey, plan, name, address, city, state, zip } = parsed.data;

    const generation = await getDb().select().from(generations).where(eq(generations.imageKey, imageKey)).limit(1);
    if (!generation[0]) return Response.json({ error: "That sticker sheet is no longer available." }, { status: 404 });
    if (generation[0].purchasedAt) return Response.json({ error: "This sticker sheet was already purchased." }, { status: 409 });

    const user = await getSessionUser(request);
    const checkoutEmail = email || user?.email || undefined;
    const origin = new URL(request.url).origin;
    const amount = plan === "physical" ? 999 : ONE_TIME_AMOUNT_CENTS;
    const baseParams = {
      mode: "payment",
      ...(checkoutEmail ? { customer_email: checkoutEmail } : {}),
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: plan === "physical" ? `${subject || "Your"} physical sticker pack` : `${subject || "Your"} digital sticker pack`,
            description: plan === "physical" ? "Ten die-cut stickers with digital pack included" : "Ten one-of-one digital stickers",
            // Shows the customer's own sheet on the checkout line item.
            images: [`${origin}/api/preview-stickers?key=${encodeURIComponent(imageKey)}`],
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      success_url: `${origin}/membership/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled&image_key=${encodeURIComponent(imageKey)}`,
      ...(plan === "physical" ? { shipping_address_collection: { allowed_countries: ["US"] } } : {}),
      metadata: {
        subject: subject || "Your",
        imageKey,
        plan,
        ...(plan === "physical" ? { name: name || "", address: address || "", city: city || "", state: state || "", zip: zip || "" } : {}),
        ...(checkoutEmail ? { email: checkoutEmail } : {}),
        ...(user ? { userId: user.id } : {}),
      },
    } as const;

    const enableAutomaticTax = automaticTaxEnabled();

    const session = await getStripe().checkout.sessions.create({
      ...baseParams,
      ...(enableAutomaticTax ? { automatic_tax: { enabled: true } } : {}),
    });

    if (user?.email && email && user.email !== email) {
      console.warn("Checkout email differs from signed-in user", { userId: user.id });
    }

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout error", error);
    if (isLocalDev) {
      const message = error instanceof Error ? error.message : "Unable to start checkout.";
      return Response.json({ error: `Unable to start checkout. ${message}` }, { status: 500 });
    }
    return Response.json({ error: "Unable to start checkout." }, { status: 500 });
  }
}
