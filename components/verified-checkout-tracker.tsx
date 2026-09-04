"use client";

import { useEffect } from "react";
import { trackOnce } from "@/lib/analytics";

type Props = {
  kind: "purchase_completed" | "subscription_started";
  stableId: string;
  properties: Parameters<typeof trackOnce>[1];
};

export function VerifiedCheckoutTracker({ kind, stableId, properties }: Props) {
  useEffect(() => {
    trackOnce(kind, properties, `${kind}:${stableId}`);
  }, [kind, properties, stableId]);

  return null;
}
