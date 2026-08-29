import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { CHECKOUT_HOURLY_CAP, ONE_TIME_AMOUNT_CENTS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse, rateLimiters } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkoutRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  const hourly = await consumeRateLimit(rateLimiters().checkout, `checkout:${await hashIp(request)}`, CHECKOUT_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  try {
    const parsed = checkoutRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A valid email and sticker sheet are required." }, { status: 400 });

    const { email, subject, imageKey, turnstileToken, plan, name, address, city, state, zip } = parsed.data;

    const turnstile = await verifyTurnstile(turnstileToken, request.headers.get("cf-connecting-ip") ?? undefined);
    if (!turnstile.ok) {
      return Response.json({ error: "We could not verify you are human. Please try again." }, { status: 403 });
    }

    const generation = await getDb().select().from(generations).where(eq(generations.imageKey, imageKey)).limit(1);
    if (!generation[0]) return Response.json({ error: "That sticker sheet is no longer available." }, { status: 404 });
    if (generation[0].purchasedAt) return Response.json({ error: "This sticker sheet was already purchased." }, { status: 409 });

    const user = await getSessionUser(request);
    const origin = new URL(request.url).origin;
    const amount = plan === "physical" ? 999 : ONE_TIME_AMOUNT_CENTS;
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: plan === "physical" ? `${subject || "Your"} physical sticker pack` : `${subject || "Your"} digital sticker pack`,
            description: plan === "physical" ? "Ten die-cut stickers with digital pack included" : "Ten one-of-one digital stickers",
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      ...(plan === "physical" ? { automatic_tax: { enabled: true }, shipping_address_collection: { allowed_countries: ["US"] } } : {}),
      metadata: {
        subject: subject || "Your",
        imageKey,
        plan,
        ...(plan === "physical" ? { name: name || "", address: address || "", city: city || "", state: state || "", zip: zip || "" } : {}),
        email,
        ...(user ? { userId: user.id } : {}),
      },
    });

    if (user?.email && user.email !== email) {
      console.warn("Checkout email differs from signed-in user", { userId: user.id });
    }

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout error", error);
    return Response.json({ error: "Unable to start checkout." }, { status: 500 });
  }
}
