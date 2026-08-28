import { and, desc, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/db";
import { orders, subscriptions, users } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ subscription?: string }>;
}) {
  const requestHeaders = await headers();
  const request = new Request("https://account.local", { headers: requestHeaders });
  const user = await getSessionUser(request);
  if (!user) redirect("/");
  const params = await searchParams;

  let account = { regenerationsRemaining: 0, subscriptionStatus: "No active subscription" };
  let history: typeof orders.$inferSelect[] = [];
  let lookupFailed = false;

  try {
    const db = getDb();
    const [profile, activeSubscription, pastOrders] = await Promise.all([
      db.select().from(users).where(eq(users.id, user.id)).limit(1),
      db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, user.id), inArray(subscriptions.status, ["active", "trialing"])))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
      db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)),
    ]);
    account = {
      regenerationsRemaining: profile[0]?.regenerationsRemaining ?? 0,
      subscriptionStatus: activeSubscription[0]?.status || "No active subscription",
    };
    history = pastOrders;
  } catch (error) {
    console.error("Account lookup failed", error);
    lookupFailed = true;
  }

  return (
    <main className="account-page">
      <header className="account-header">
        <div>
          <span className="eyebrow">YOUR STICKIER ACCOUNT</span>
          <h1>Welcome back,<br /><em>{user.displayName}.</em></h1>
          <p>{user.email}</p>
          {params.subscription === "success" ? <p role="status">Your membership is active. Regenerations refresh each billing period.</p> : null}
          {lookupFailed ? <p role="alert">We could not load your account details. Please refresh in a moment.</p> : null}
        </div>
        <div className="account-header-actions">
          <form action="/api/account/portal" method="post">
            <button className="account-portal" type="submit">MANAGE BILLING</button>
          </form>
          <a className="account-signout" href="/api/auth/signout">SIGN OUT</a>
        </div>
      </header>
      <section className="account-stats">
        <article><span>MEMBERSHIP</span><strong>{account.subscriptionStatus}</strong><small>$9.99 / month</small></article>
        <article><span>REGENERATIONS LEFT</span><strong>{account.regenerationsRemaining}</strong><small>Resets to 20 each billing period</small></article>
      </section>
      <section className="account-history">
        <div className="account-section-head">
          <div><span className="eyebrow">YOUR ARCHIVE</span><h2>Past orders.</h2></div>
          <Link className="account-create" href="/">MAKE A NEW SHEET <span>→</span></Link>
        </div>
        {history.length === 0 ? (
          <p className="account-empty">Your paid sticker sheets will appear here.</p>
        ) : (
          <div className="order-list">
            {history.map((order) => (
              <article className="order-row" key={order.id}>
                <div>
                  <strong>{order.subject}&apos;s sticker sheet</strong>
                  <small>{order.kind === "subscription" ? "Monthly membership" : "One-time purchase"}</small>
                </div>
                <time>{new Date(order.createdAt).toLocaleDateString()}</time>
                <span>${(order.amount / 100).toFixed(2)}</span>
                <a href={`/api/download-stickers?session_id=${encodeURIComponent(order.stripeSessionId)}`}>Download</a>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
