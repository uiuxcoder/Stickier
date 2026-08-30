"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

export default function MembershipPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function beginCheckout() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/create-subscription-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "membership-page" }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || "Unable to start checkout.");
      window.location.assign(data.url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
      setIsLoading(false);
    }
  }

  return (
    <main className="membership-shell">
      <section className="membership-card">
        <p className="membership-kicker">Sticker Club</p>
        <h1>$19.99/month</h1>
        <p className="membership-summary">20 creations this month. Choose your 3. Ship your 3 anytime before month-end.</p>
        <ul>
          <li>
            <Check size={14} /> 20 sticker creations every month
          </li>
          <li>
            <Check size={14} /> Pick any 3 to get in the mail
          </li>
          <li>
            <Check size={14} /> One monthly drop of 3 included
          </li>
        </ul>
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={beginCheckout} disabled={isLoading}>
          {isLoading ? "Opening Stripe Checkout..." : "Join Sticker Club"} <ArrowRight size={16} />
        </button>
      </section>
    </main>
  );
}
