import Stripe from "stripe";

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { email, subject, imageKey } = (await request.json()) as {
      email?: string;
      subject?: string;
      imageKey?: string;
    };

    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !imageKey || !/^stickers\/[\w-]+\.png$/.test(imageKey)) {
      return Response.json({ error: "A valid email is required." }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${subject || "Your"} digital sticker pack`,
              description: "Ten one-of-one digital stickers",
            },
            unit_amount: 399,
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}&email=${encodeURIComponent(email)}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      metadata: { subject: subject || "Your", imageKey },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout error", error);
    return Response.json({ error: "Unable to start checkout." }, { status: 500 });
  }
}