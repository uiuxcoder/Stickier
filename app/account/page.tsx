import { and, desc, eq, inArray, or } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations, membershipDrops, subscriptions, users } from "@/db/schema";
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
  let currentPeriodEnd: number | null = null;
  let stickerCards: { id: string; imageUrl: string; createdAt: number }[] = [];
  let shippingAddress: string[] = [];
  let drops: { monthKey: string; stickerIds: string[]; submittedAt: number; status: "submitted" | "printing" | "shipped" | "delivered" }[] = [];

  try {
    const db = getDb();
    const [profile, activeSubscription, latestSubscription, allGenerations, allDrops] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.id))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
      db
        .select()
        .from(generations)
        .where(or(eq(generations.userId, user.id), eq(generations.email, user.email)))
        .orderBy(desc(generations.createdAt)),
      db.select().from(membershipDrops).where(eq(membershipDrops.userId, user.id)).orderBy(desc(membershipDrops.submittedAt)),
    ]);

    isActive = Boolean(activeSubscription[0]);
    currentPeriodEnd = latestSubscription[0]?.currentPeriodEnd ?? null;
    remainingCreations = isActive
      ? Math.max(0, Math.min(MONTHLY_REGENERATIONS, profile[0]?.regenerationsRemaining ?? 0))
      : 0;
    stickerCards = allGenerations.map((generation) => ({
      id: generation.imageKey,
      imageUrl: `/api/preview-stickers?key=${encodeURIComponent(generation.imageKey)}`,
      createdAt: generation.createdAt,
    }));
    await Promise.all(
      allGenerations
        .filter((generation) => generation.userId !== user.id && generation.email === user.email)
        .map((generation) => db.update(generations).set({ userId: user.id }).where(eq(generations.imageKey, generation.imageKey))),
    );
    drops = allDrops.flatMap((drop) => {
      let stickerIds: unknown;
      try {
        stickerIds = JSON.parse(drop.stickerIds);
      } catch {
        return [];
      }
      if (!Array.isArray(stickerIds) || !stickerIds.every((id) => typeof id === "string")) return [];
      const status = ["submitted", "printing", "shipped", "delivered"].includes(drop.status)
        ? drop.status as "submitted" | "printing" | "shipped" | "delivered"
        : "submitted";
      return [{ monthKey: drop.monthKey, stickerIds, submittedAt: drop.submittedAt, status }];
    });

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
      isActive={isActive}
      currentPeriodEnd={currentPeriodEnd}
      remainingCreations={remainingCreations}
      stickers={stickerCards}
      shippingAddress={shippingAddress}
      drops={drops}
    />
  );
}
