import Stripe from "stripe";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to subscribe." }, { status: 401 });
  if (!process.env.STRIPE_SECRET_KEY) return Response.json({ error: "Stripe is not configured." }, { status: 500 });

  try {
    const { subject, imageKey } = (await request.json()) as { subject?: string; imageKey?: string };
    if (!imageKey || !/^stickers\/[\w-]+\.png$/.test(imageKey)) {
      return Response.json({ error: "A sticker sheet is required." }, { status: 400 });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Stickier monthly membership", description: "20 sticker regenerations each month" },
          unit_amount: 999,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      success_url: `${origin}/account?subscription=success`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { email: user.email, subject: subject || "Your", imageKey, monthlyRegenerations: "20" },
      subscription_data: { metadata: { email: user.email, monthlyRegenerations: "20" } },
    });
    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe subscription error", error);
    return Response.json({ error: "Unable to start subscription." }, { status: 500 });
  }
}
