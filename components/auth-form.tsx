"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

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
    eyebrow: "WELCOME BACK",
    title: "Sign in.",
    submit: "SIGN IN",
    description: "Use the email and password for your Stickier account.",
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

export function AuthForm({ mode, token, initialEmail = "", notice, returnTo = "/" }: Props) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(notice || "");
  const [loading, setLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement | null>(null);
  const turnstileWidgetId = useRef<string | undefined>(undefined);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!turnstileSiteKey) return;
    const render = () => {
      if (turnstileRef.current && window.turnstile && !turnstileWidgetId.current) {
        turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          callback: (value: string) => setTurnstileToken(value),
          "expired-callback": () => setTurnstileToken(""),
        });
      }
    };
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [turnstileSiteKey]);

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
          turnstileToken: turnstileToken || undefined,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        code?: string;
        needsVerification?: boolean;
        emailed?: boolean;
        user?: { email?: string };
      };
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
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId.current);
        setTurnstileToken("");
      }
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
        body: JSON.stringify({ email, turnstileToken: turnstileToken || undefined }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
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
  const canSubmit = turnstileSiteKey ? Boolean(turnstileToken) : true;

  return (
    <section className="auth-card">
      <span className="eyebrow">{fields.eyebrow}</span>
      <h1>{fields.title}</h1>
      <p>{fields.description}</p>
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
        {turnstileSiteKey ? <div ref={turnstileRef} className="turnstile-widget" /> : null}
        {error ? <p role="alert">{error}</p> : null}
        {status ? <p role="status">{status}</p> : null}
        {unverified ? (
          <button className="auth-text-btn" type="button" onClick={() => void resend()}>
            RESEND CONFIRMATION EMAIL
          </button>
        ) : null}
        <Button className="red-btn" type="submit" disabled={loading || !canSubmit}>
          {loading ? "PLEASE WAIT…" : fields.submit} <ArrowRight />
        </Button>
      </form>
      {mode === "signin" ? (
        <div className="auth-links">
          <Link href={`/signup?return_to=${encodeURIComponent(returnTo)}`}>Create an account</Link>
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
