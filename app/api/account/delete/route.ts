import { env } from "cloudflare:workers";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { generations, orders, subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Delete the signed-in user's account and stored data: profile, subscription
 * records, order history, and any generated images held in R2. This backs the
 * right-to-erasure commitment in the privacy policy.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign in to delete your account." }, { status: 401 });

  const db = getDb();
  const bucket = env.STICKER_ASSETS;

  try {
    const userGenerations = await db
      .select({ imageKey: generations.imageKey })
      .from(generations)
      .where(eq(generations.userId, user.id));

    if (bucket) {
      for (const row of userGenerations) {
        await bucket.delete(row.imageKey).catch((error) =>
          console.error("Failed to delete image", row.imageKey, error)
        );
      }
    }

    await db.delete(generations).where(eq(generations.userId, user.id));
    await db.delete(orders).where(eq(orders.userId, user.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Account deletion failed", user.id, error);
    return Response.json({ error: "Unable to delete account." }, { status: 500 });
  }
}
