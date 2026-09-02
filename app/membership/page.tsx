"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

export default function MembershipPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function beginCheckout() {
    setIsLoading(true);
    setError("");
    window.location.assign("/membership/checkout?source=membership-page");
  }

  return (
    <main className="membership-shell">
      <section className="membership-card">
        <p className="membership-kicker">Sticker Club</p>
        <h1>$11.99/month</h1>
        <p className="membership-summary">20 creations this month. Choose your 2. Ship your 2 anytime before month-end.</p>
        <ul>
          <li>
            <Check size={14} /> 20 sticker creations every month
          </li>
          <li>
            <Check size={14} /> Pick any 2 to get in the mail
          </li>
          <li>
            <Check size={14} /> One monthly drop of 2 included
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
