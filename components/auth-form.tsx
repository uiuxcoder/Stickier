"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type AuthMode = "signin" | "signup" | "forgot" | "reset";

type Props = {
  mode: AuthMode;
  token?: string;
  initialEmail?: string;
  notice?: string;
  /** Sanitized on the server so the rendered links match the first paint. */
  returnTo?: string;
};

const copy: Record<AuthMode, { eyebrow: string; title: string; submit: string; description: string }> = {
  signin: {
    eyebrow: "",
    title: "Welcome back ✦",
    submit: "LOG IN",
    description: "Log in to your Salty Sticker Club account.",
  },
  signup: {
    eyebrow: "NEW ACCOUNT",
    title: "Create an account.",
    submit: "CREATE ACCOUNT",
    description: "Save orders, download past sheets, and subscribe for regenerations.",
  },
  forgot: {
    eyebrow: "PASSWORD HELP",
    title: "Reset your password.",
    submit: "SEND RESET LINK",
    description: "We’ll email a one-time link if this address has an account.",
  },
  reset: {
    eyebrow: "NEW PASSWORD",
    title: "Choose a new password.",
    submit: "SAVE PASSWORD",
    description: "Pick something you haven’t used here before.",
  },
};

type AuthResponse = {
  error?: string;
  code?: string;
  needsVerification?: boolean;
  emailed?: boolean;
  user?: { email?: string };
};

export async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const text = await response.text();
  if (!text) {
    throw new Error("The server did not respond. Please try again.");
  }

  try {
    return JSON.parse(text) as AuthResponse;
  } catch {
    throw new Error("The server returned an unexpected response. Please try again.");
  }
}

function GoogleIcon() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.7-.06-1.37-.18-2.02H12v3.82h5.39a4.61 4.61 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.97-4.33 2.97-7.32Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.61-2.43l-3.24-2.5c-.9.6-2.05.96-3.37.96-2.59 0-4.79-1.75-5.58-4.1H.7v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.42 19.89A6.02 6.02 0 0 1 6 17.3V14.7H2.73A10 10 0 0 0 2 12c0-1.64.39-3.2 1.09-4.58L6.4 10c-.26.82-.4 1.7-.4 2.6 0 .9.14 1.78.4 2.6l-.02 0Z"
      />
      <path
        fill="#EA4335"
        d="M12 3.98c1.47 0 2.79.51 3.84 1.5l2.87-2.87A9.99 9.99 0 0 0 12 2a10 10 0 0 0-9.3 5.42L6.4 10c.79-2.35 2.99-4.02 5.6-4.02Z"
      />
    </svg>
  );
}

export function AuthForm({ mode, token, initialEmail = "", notice, returnTo = "/" }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(notice || "");
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatus("");
    setUnverified(false);
    setLoading(true);
    try {
      const path =
        mode === "signin"
          ? "/api/auth/signin"
          : mode === "signup"
            ? "/api/auth/signup"
            : mode === "forgot"
              ? "/api/auth/forgot-password"
              : "/api/auth/reset-password";
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          fullName: fullName || undefined,
          token,
          returnTo,
        }),
      });
      const data = await readAuthResponse(response);
      if (!response.ok) {
        if (data.code === "unverified") setUnverified(true);
        throw new Error(data.error || "Unable to continue.");
      }
      if (mode === "signup" && data.needsVerification) {
        setStatus(
          data.emailed === false
            ? data.error || "Account created. We could not send the confirmation email yet."
            : "Check your email for a confirmation link. It expires in 24 hours."
        );
        return;
      }
      if (mode === "forgot") {
        setStatus("If that email has an account, a reset link is on its way.");
        return;
      }
      window.location.assign(returnTo || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const data = await readAuthResponse(response);
        throw new Error(data.error || "Unable to resend.");
      }
      setStatus("If that email still needs confirming, a new link is on its way.");
      setUnverified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to resend.");
    } finally {
      setLoading(false);
    }
  };

  const fields = copy[mode];

  return (
    <section className="auth-card">
      {fields.eyebrow ? <span className="eyebrow">{fields.eyebrow}</span> : null}
      <h1>{fields.title}</h1>
      <p>{fields.description}</p>
      {mode === "signin" || mode === "signup" ? (
        <>
          <a className="google-auth-button" href={`/api/auth/google?return_to=${encodeURIComponent(returnTo)}`}>
            <GoogleIcon />
            Continue with Google
          </a>
          <div className="auth-divider"><span>OR</span></div>
        </>
      ) : null}
      <form className="auth-form" onSubmit={submit}>
        {mode !== "reset" ? (
          <label>
            <span>EMAIL</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
        ) : null}
        {mode === "signup" ? (
          <label>
            <span>NAME <em>(OPTIONAL)</em></span>
            <input
              type="text"
              autoComplete="name"
              maxLength={80}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="What should we call you?"
            />
          </label>
        ) : null}
        {mode === "signin" || mode === "signup" || mode === "reset" ? (
          <label>
            <span>{mode === "reset" ? "NEW PASSWORD" : "PASSWORD"}</span>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
            />
          </label>
        ) : null}
        {error ? (
          <>
            <p role="alert">{error}</p>
            {mode === "signin" && /No Sticker Club account found/i.test(error) ? (
              <Link className="auth-text-btn auth-inline-link" href="/membership">Join Salty Sticker Club →</Link>
            ) : null}
          </>
        ) : null}
        {status ? <p role="status">{status}</p> : null}
        {unverified ? (
          <button className="auth-text-btn" type="button" onClick={() => void resend()}>
            RESEND CONFIRMATION EMAIL
          </button>
        ) : null}
        <Button className="red-btn" type="submit" disabled={loading}>
          {loading ? "PLEASE WAIT…" : fields.submit} <ArrowRight />
        </Button>
      </form>
      {mode === "signin" ? (
        <div className="auth-links auth-links-inline">
          <p className="auth-subtle">Not a member yet?</p>
          <Link href="/membership">Join Salty Sticker Club →</Link>
          <Link href="/forgot-password">Forgot password</Link>
        </div>
      ) : null}
      {mode === "signup" ? (
        <div className="auth-links">
          <Link href={`/signin?return_to=${encodeURIComponent(returnTo)}`}>Already have an account? Sign in</Link>
        </div>
      ) : null}
      {mode === "forgot" ? (
        <div className="auth-links">
          <Link href="/signin">Back to sign in</Link>
        </div>
      ) : null}
    </section>
  );
}
