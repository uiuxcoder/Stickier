const MODERATION_URL = "https://api.openai.com/v1/moderations";

export type ModerationVerdict = {
  allowed: boolean;
  reason?: string;
};

/**
 * Screen user-supplied prompt text with OpenAI's moderation model before it is
 * sent to image generation. Fails closed on API errors: if we cannot screen the
 * content, we do not generate.
 */
export async function moderateText(text: string): Promise<ModerationVerdict> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { allowed: false, reason: "moderation-unconfigured" };
  const trimmed = text.trim();
  if (!trimmed) return { allowed: true };

  try {
    const response = await fetch(MODERATION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "omni-moderation-latest", input: trimmed }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("Moderation request failed", response.status);
      return { allowed: false, reason: "moderation-unavailable" };
    }
    const result = (await response.json()) as {
      results?: { flagged?: boolean; categories?: Record<string, boolean> }[];
    };
    const first = result.results?.[0];
    if (!first) return { allowed: false, reason: "moderation-unavailable" };
    if (first.flagged) {
      const categories = Object.entries(first.categories ?? {})
        .filter(([, hit]) => hit)
        .map(([name]) => name);
      return { allowed: false, reason: categories.join(",") || "flagged" };
    }
    return { allowed: true };
  } catch (error) {
    console.error("Moderation request error", error);
    return { allowed: false, reason: "moderation-unavailable" };
  }
}
