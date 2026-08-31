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
      : undefined;
  return <AuthForm mode="signin" notice={notice} returnTo={safeRelativeReturnPath(params.return_to)} />;
}
