"use client";

import { useState } from "react";

export function JoinStickerClubButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/create-subscription-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "digital-success" }),
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
    <div className="join-club-button-wrap">
      <button type="button" className="join-club-secondary-btn" onClick={handleClick} disabled={isLoading}>
        {isLoading ? "Opening Stripe Checkout..." : "Join Sticker Club ✦"}
      </button>
      {error ? <p role="alert" className="join-club-error">{error}</p> : null}
    </div>
  );
}
