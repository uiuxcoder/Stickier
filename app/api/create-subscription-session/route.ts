import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { CHECKOUT_HOURLY_CAP, MONTHLY_REGENERATIONS, SUBSCRIPTION_AMOUNT_CENTS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { subscriptionRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to subscribe." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Stripe is not configured." }, { status: 500 });

  const hourly = await consumeRateLimit(`checkout:${await hashIp(request)}`, CHECKOUT_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  try {
    const parsed = subscriptionRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A sticker sheet is required." }, { status: 400 });

    const { subject, imageKey } = parsed.data;
    const generation = await getDb().select().from(generations).where(eq(generations.imageKey, imageKey)).limit(1);
    if (!generation[0]) return Response.json({ error: "That sticker sheet is no longer available." }, { status: 404 });

    const origin = new URL(request.url).origin;
    const priceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Stickier monthly membership",
                  description: `${MONTHLY_REGENERATIONS} sticker regenerations each month`,
                },
                unit_amount: SUBSCRIPTION_AMOUNT_CENTS,
                recurring: { interval: "month" },
              },
              quantity: 1,
            },
          ],
      success_url: `${origin}/account?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: {
        email: user.email,
        subject: subject || "Your",
        imageKey,
        monthlyRegenerations: String(MONTHLY_REGENERATIONS),
      },
      subscription_data: {
        metadata: { email: user.email, monthlyRegenerations: String(MONTHLY_REGENERATIONS) },
      },
    });
    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe subscription error", error);
    return Response.json({ error: "Unable to start subscription." }, { status: 500 });
  }
}
