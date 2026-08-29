import { AuthForm } from "@/components/auth-form";
import { safeRelativeReturnPath } from "@/lib/auth-utils";

export const metadata = {
  title: "Create an account — Stickier",
  description: "Create a Stickier account to save orders and subscribe for regenerations.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="signup" returnTo={safeRelativeReturnPath(params.return_to)} />;
}
