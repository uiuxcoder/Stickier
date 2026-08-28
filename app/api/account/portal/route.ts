import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";

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
    const profile = await getDb()
      .select({ stripeCustomerId: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const customerId = profile[0]?.stripeCustomerId;
    if (!customerId) {
      return Response.json({ error: "No billing account found." }, { status: 404 });
    }

    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Customer Portal error", error);
    return Response.json({ error: "Unable to open billing." }, { status: 500 });
  }
}
