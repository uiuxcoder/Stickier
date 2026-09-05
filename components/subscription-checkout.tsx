"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { track } from "@/lib/analytics";

type SubscriptionCheckoutRequest = {
  imageKey?: string;
  subject?: string;
  source?: string;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
  resumable?: boolean;
  endDate?: string;
  message?: string;
};

function requestFromLocation(): SubscriptionCheckoutRequest {
  const params = new URLSearchParams(window.location.search);
  return {
    imageKey: params.get("image_key") || undefined,
    subject: params.get("subject") || undefined,
    source: params.get("source") || undefined,
  };
}

async function createSubscriptionCheckout(
  request: SubscriptionCheckoutRequest,
): Promise<{ url: string } | { resumable: boolean; endDate: string } | null> {
  const response = await fetch("/api/create-subscription-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await response.json()) as CheckoutResponse;
  if (response.status === 401) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/signup?return_to=${encodeURIComponent(returnTo)}`);
    return null;
  }
  if (data.resumable) {
    return { resumable: true, endDate: data.endDate || "" };
  }
  if (!response.ok || !data.url) throw new Error(data.error || "Unable to start checkout.");
  return { url: data.url };
}

async function resumeMembership() {
  const response = await fetch("/api/membership/resume", {
    method: "POST",
  });
  const data = (await response.json()) as { success?: boolean; message?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Unable to resume membership.");
  return data.message || "Membership resumed!";
}

export function SubscriptionCheckout() {
  const started = useRef(false);
  const [error, setError] = useState("");
  const [resumable, setResumable] = useState<{ endDate: string } | null>(null);
  const [resuming, setResuming] = useState(false);

  async function startCheckout() {
    setError("");
    try {
      const result = await createSubscriptionCheckout(requestFromLocation());
      if (!result) return;
      if ("url" in result) {
        track("checkout_opened", { product_type: "sticker_club", price: 16.99, currency: "USD", is_subscription: true });
        window.location.assign(result.url);
      } else if ("resumable" in result) {
        setResumable({ endDate: result.endDate });
      }
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
    }
  }

  async function handleResume() {
    setResuming(true);
    setError("");
    try {
      await resumeMembership();
      // Redirect to account page after successful resume
      window.location.assign("/account");
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : "Unable to resume membership.");
      setResuming(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void createSubscriptionCheckout(requestFromLocation())
      .then((result) => {
        if (!result) return;
        if ("url" in result) {
          track("checkout_opened", { product_type: "sticker_club", price: 16.99, currency: "USD", is_subscription: true });
          window.location.assign(result.url);
        } else if ("resumable" in result) {
          setResumable({ endDate: result.endDate });
        }
      })
      .catch((checkoutError) => {
        setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start checkout.");
      });
  }, []);

  return (
    <main className="membership-shell">
      <section className="membership-card">
        <p className="membership-kicker">Sticker Club</p>
        <h1>$16.99/month</h1>
        {resumable ? (
          <>
            <p className="membership-summary">Your membership is still active through {resumable.endDate}. Would you like to resume it?</p>
            {error ? <p role="alert">{error}</p> : null}
            <button type="button" onClick={() => void handleResume()} disabled={resuming}>
              {resuming ? "Resuming..." : "Resume membership"}
            </button>
            <Link href="/account">Go to account</Link>
          </>
        ) : error ? (
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