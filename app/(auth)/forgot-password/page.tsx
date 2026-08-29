import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Reset password — Stickier",
  description: "Send a password reset link to your Stickier email.",
};

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
