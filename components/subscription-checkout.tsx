"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";

type SubscriptionCheckoutRequest = {
  imageKey?: string;
  subject?: string;
  source?: string;
};

function requestFromLocation(): SubscriptionCheckoutRequest {
  const params = new URLSearchParams(window.location.search);
  return {
    imageKey: params.get("image_key") || undefined,
    subject: params.get("subject") || undefined,
    source: params.get("source") || undefined,
  };
}

async function createSubscriptionCheckout(request: SubscriptionCheckoutRequest) {
  const response = await fetch("/api/create-subscription-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await response.json()) as { url?: string; error?: string };
  if (response.status === 401) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/signup?return_to=${encodeURIComponent(returnTo)}`);
    return null;
  }
  if (!response.ok || !data.url) throw new Error(data.error || "Unable to start checkout.");
  return data.url;
}

export function SubscriptionCheckout() {
  const started = useRef(false);
  const [error, setError] = useState("");

  async function startCheckout() {
    setError("");
    try {
      const url = await createSubscriptionCheckout(requestFromLocation());
      if (url) window.location.assign(url);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void createSubscriptionCheckout(requestFromLocation())
      .then((url) => { if (url) window.location.assign(url); })
      .catch((checkoutError) => {
        setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
      });
  }, []);

  return (
    <main className="membership-shell">
      <section className="membership-card">
        <p className="membership-kicker">Sticker Club</p>
        <h1>$14.99/month</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => void startCheckout()}>Try again</button>
            <Link href="/">Return to your stickers</Link>
          </>
        ) : (
          <p className="membership-summary"><LoaderCircle className="checkout-spinner" /> Opening secure Stripe Checkout...</p>
        )}
      </section>
    </main>
  );
}