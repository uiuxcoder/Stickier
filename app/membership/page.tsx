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
        <h1>$16.99/month</h1>
        <p className="membership-summary">20 sticker generations, unlimited downloads. Pick 2 to receive at your doorstep every month. Free shipping.</p>
        <ul>
          <li>
            <Check size={14} /> 20 sticker generations, unlimited downloads
          </li>
          <li>
            <Check size={14} /> Pick 2 to receive at your doorstep every month
          </li>
          <li>
            <Check size={14} /> Free shipping
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
