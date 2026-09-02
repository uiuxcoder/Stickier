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
    <svg className="google-mark" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M17.64 9.2045c0-.638-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7973 2.7164v2.2582h2.9082c1.702-1.5673 2.6855-3.8741 2.6855-6.6155Z"
      />
      <path
        fill="#4285F4"
        d="M9 18c2.43 0 4.4673-.8055 5.9564-2.1782l-2.9082-2.2582c-.8055.54-1.8355.8591-3.0482.8591-2.3441 0-4.3282-1.5845-5.0364-3.7105H.9573v2.3318A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.9636 10.7122A5.411 5.411 0 0 1 3.6818 9c0-.5927.1018-1.1682.2818-1.7123V4.9559H.9573A9 9 0 0 0 0 9c0 1.4523.3477 2.8277.9573 4.0441l3.0063-2.3319Z"
      />
      <path
        fill="#34A853"
        d="M9 3.5795c1.3214 0 2.5077.4545 3.4418 1.3459l2.5818-2.5818C13.4632.8918 11.43 0 9 0A9 9 0 0 0 .9573 4.9559l3.0063 2.3318C4.6718 5.1641 6.6559 3.5795 9 3.5795Z"
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
          <div className="auth-membership-links">
            <p className="auth-subtle">Not a member yet?</p>
            <Link href="/membership">Join Salty Sticker Club →</Link>
          </div>
          <Link className="auth-forgot-link" href="/forgot-password">Forgot password</Link>
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
