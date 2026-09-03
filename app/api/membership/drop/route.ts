import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations, membershipDrops, subscriptions, users } from "@/db/schema";
import { IMAGE_KEY_PATTERN, MONTHLY_PHYSICAL_SHEETS, SUBSCRIPTION_AMOUNT_CENTS } from "@/lib/constants";
import { sendDropSubmittedEmails } from "@/lib/fulfillment-email";
import { getStripe } from "@/lib/stripe";

const dropSchema = z.object({
  stickerIds: z.array(z.string().regex(IMAGE_KEY_PATTERN)).length(MONTHLY_PHYSICAL_SHEETS),
}).refine((value) => new Set(value.stickerIds).size === MONTHLY_PHYSICAL_SHEETS, { message: "Choose two different sticker sheets." });

function currentMonth() {
  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { monthKey, monthLabel };
}

export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign in to submit your monthly stickers." }, { status: 401 });

  const parsed = dropSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose exactly two sticker sheets." }, { status: 400 });

  const db = getDb();
  const [activeSubscription, profile, ownedStickers] = await Promise.all([
    db.select({ id: subscriptions.stripeSubscriptionId }).from(subscriptions)
      .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"]))).limit(1),
    db.select({ stripeCustomerId: users.stripeCustomerId }).from(users).where(eq(users.id, user.id)).limit(1),
    db.select({ imageKey: generations.imageKey }).from(generations)
      .where(and(eq(generations.userId, user.id), inArray(generations.imageKey, parsed.data.stickerIds))),
  ]);
  if (!activeSubscription[0]) return Response.json({ error: "An active membership is required." }, { status: 403 });
  if (ownedStickers.length !== MONTHLY_PHYSICAL_SHEETS) return Response.json({ error: "One or more sticker sheets are unavailable." }, { status: 403 });

  const customerId = profile[0]?.stripeCustomerId;
  if (!customerId || !process.env.STRIPE_SECRET_KEY) {
    return Response.json({ error: "Add a shipping address before submitting." }, { status: 400 });
  }
  const customer = await getStripe().customers.retrieve(customerId);
  if (customer.deleted) return Response.json({ error: "Add a shipping address before submitting." }, { status: 400 });
  const address = customer.shipping?.address || customer.address;
  const shippingAddress = address ? [
    customer.shipping?.name || customer.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postal_code].filter(Boolean).join(" "),
    address.country,
  ].map((line) => (line || "").trim()).filter(Boolean) : [];
  if (shippingAddress.length < 3) return Response.json({ error: "Add a complete shipping address before submitting." }, { status: 400 });

  const { monthKey, monthLabel } = currentMonth();
  try {
    await db.insert(membershipDrops).values({
      id: crypto.randomUUID(),
      userId: user.id,
      monthKey,
      stickerIds: JSON.stringify(parsed.data.stickerIds),
      shippingAddress: JSON.stringify(shippingAddress),
      status: "submitted",
      submittedAt: Date.now(),
    });
  } catch (error) {
    if (String(error).includes("UNIQUE")) {
      return Response.json({ error: "This month’s stickers were already submitted." }, { status: 409 });
    }
    throw error;
  }

  const notification = await sendDropSubmittedEmails({
    customerEmail: user.email,
    customerName: user.fullName,
    orderPrice: `$${(SUBSCRIPTION_AMOUNT_CENTS / 100).toFixed(2)}/month membership`,
    monthLabel,
    stickerIds: parsed.data.stickerIds,
    shippingAddress,
  });
  if (!notification.ok) console.error("Drop notification failed", notification.error);
  return Response.json({ monthKey, stickerIds: parsed.data.stickerIds, status: "submitted", submittedAt: Date.now() });
}