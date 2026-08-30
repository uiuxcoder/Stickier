const AUTH_PAGES = new Set([
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/signin-with-chatgpt",
  "/signout-with-chatgpt",
  "/callback",
]);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Same-origin relative path for post-auth redirects. Rejects protocol-relative
 * URLs, auth pages, and API routes so a return_to cannot bounce users into a
 * second sign-in or a state-changing endpoint.
 */
export function safeRelativeReturnPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (url.pathname.startsWith("/api/")) return "/";
  if (AUTH_PAGES.has(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

export function appOrigin(request: Request): string {
  const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") return "https://saltysticker.com";
  return new URL(request.url).origin;
}
