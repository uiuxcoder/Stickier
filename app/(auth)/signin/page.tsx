import { AuthForm } from "@/components/auth-form";
import { safeRelativeReturnPath } from "@/lib/auth-utils";

export const metadata = {
  title: "Sign in — Salty Sticker™",
  description: "Sign in to your Salty Sticker account to manage orders and membership.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; return_to?: string }>;
}) {
  const params = await searchParams;
  const notice =
    params.error === "invalid_link"
      ? "That confirmation link is invalid or has expired. Sign in, or request a new email."
      : params.error === "google_config"
        ? "Google sign-in is not configured yet. Use email and password for now."
        : params.error === "google_cancelled"
          ? "Google sign-in was cancelled."
          : params.error === "google_state"
            ? "That Google sign-in request expired. Please try again."
            : params.error === "google_failed"
              ? "Google could not sign you in. Please try again or use email and password."
      : undefined;
  return <AuthForm mode="signin" notice={notice} returnTo={safeRelativeReturnPath(params.return_to)} />;
}
