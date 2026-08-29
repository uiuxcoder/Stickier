import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Choose a new password — Stickier",
  description: "Set a new password for your Stickier account.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <section className="auth-card">
        <span className="eyebrow">PASSWORD HELP</span>
        <h1>This reset link is missing.</h1>
        <p>Request a new password reset from the sign-in page.</p>
        <div className="auth-links">
          <a href="/forgot-password">Send a new link</a>
        </div>
      </section>
    );
  }
  return <AuthForm mode="reset" token={token} />;
}
