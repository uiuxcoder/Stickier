import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { generations } from "@/db/schema";
import { CHECKOUT_HOURLY_CAP, ONE_TIME_AMOUNT_CENTS } from "@/lib/constants";
import { consumeRateLimit, hashIp, rateLimitResponse } from "@/lib/rate-limit";
import { getStripe } from "@/lib/stripe";
import { checkoutRequestSchema } from "@/lib/validation";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  const hourly = await consumeRateLimit(`checkout:${await hashIp(request)}`, CHECKOUT_HOURLY_CAP, 60 * 60 * 1000);
  if (!hourly.ok) return rateLimitResponse(hourly.retryAfterMs);

  try {
    const parsed = checkoutRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A valid email and sticker sheet are required." }, { status: 400 });

    const { email, subject, imageKey } = parsed.data;
    const generation = await getDb().select().from(generations).where(eq(generations.imageKey, imageKey)).limit(1);
    if (!generation[0]) return Response.json({ error: "That sticker sheet is no longer available." }, { status: 404 });
    if (generation[0].purchasedAt) return Response.json({ error: "This sticker sheet was already purchased." }, { status: 409 });

    const user = await getChatGPTUser();
    const origin = new URL(request.url).origin;
    const priceId = process.env.STRIPE_PRICE_ID;
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: priceId
        ? [{ price: priceId, quantity: 1 }]
        : [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `${subject || "Your"} digital sticker pack`,
                  description: "Ten one-of-one digital stickers",
                },
                unit_amount: ONE_TIME_AMOUNT_CENTS,
              },
              quantity: 1,
            },
          ],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { subject: subject || "Your", imageKey, email },
    });

    if (user?.email && user.email !== email) {
      console.warn("Checkout email differs from signed-in ChatGPT user");
    }

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout error", error);
    return Response.json({ error: "Unable to start checkout." }, { status: 500 });
  }
}
