import { and, desc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations, subscriptions, users } from "@/db/schema";
import { MemberDashboard } from "@/components/member-dashboard";
import { MONTHLY_REGENERATIONS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const request = new Request("https://account.local", { headers: requestHeaders });
  const user = await getSessionUser(request);
  if (!user) redirect("/signin?return_to=/account");

  let remainingCreations = 0;
  let isActive = false;
  let stickerCards: { id: string; imageUrl: string; createdAt: number }[] = [];
  let shippingAddress: string[] = [];

  try {
    const db = getDb();
    const [profile, activeSubscription, allGenerations] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
      db.select().from(generations).where(eq(generations.userId, user.id)).orderBy(desc(generations.createdAt)),
    ]);

    isActive = Boolean(activeSubscription[0]);
    remainingCreations = isActive
      ? Math.max(0, Math.min(MONTHLY_REGENERATIONS, profile[0]?.regenerationsRemaining ?? 0))
      : 0;
    stickerCards = allGenerations.map((generation) => ({
      id: generation.imageKey,
      imageUrl: `/api/preview-stickers?key=${encodeURIComponent(generation.imageKey)}`,
      createdAt: generation.createdAt,
    }));

    const stripeCustomerId = profile[0]?.stripeCustomerId;
    if (stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const customer = await getStripe().customers.retrieve(stripeCustomerId);
        if (!customer.deleted) {
          const address = customer.shipping?.address || customer.address;
          if (address) {
            shippingAddress = [
              customer.shipping?.name || customer.name,
              address.line1,
              address.line2,
              [address.city, address.state, address.postal_code].filter(Boolean).join(" "),
              address.country,
            ]
              .map((line) => (line || "").trim())
              .filter(Boolean);
          }
        }
      } catch (error) {
        console.error("Shipping address lookup failed", error);
      }
    }
  } catch (error) {
    console.error("Account lookup failed", error);
  }

  return (
    <MemberDashboard
      userId={user.id}
      isActive={isActive}
      remainingCreations={remainingCreations}
      stickers={stickerCards}
      shippingAddress={shippingAddress}
    />
  );
}
