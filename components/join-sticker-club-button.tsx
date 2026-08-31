"use client";

import { useState } from "react";

type JoinStickerClubButtonProps = {
  imageKey?: string;
  subject?: string;
};

export function JoinStickerClubButton({ imageKey, subject }: JoinStickerClubButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setIsLoading(true);
    setError("");
    const params = new URLSearchParams({ source: "digital-success" });
    if (imageKey) params.set("image_key", imageKey);
    if (subject) params.set("subject", subject);
    window.location.assign(`/membership/checkout?${params}`);
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
