import { AuthForm } from "@/components/auth-form";

export const metadata = {
  title: "Reset password — Salty Sticker™",
  description: "Send a password reset link to your Salty Sticker account email.",
};

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
