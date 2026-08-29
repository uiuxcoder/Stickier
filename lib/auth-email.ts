import { Resend } from "resend";

function fromAddress() {
  return process.env.RESEND_FROM_EMAIL;
}

function canSendEmail() {
  return Boolean(process.env.RESEND_API_KEY && fromAddress());
}

/** Local development without Resend still needs a working sign-up path. */
export function authEmailOptional(): boolean {
  return process.env.NODE_ENV !== "production" && !canSendEmail();
}

async function send(to: string, subject: string, html: string) {
  if (!canSendEmail()) {
    if (authEmailOptional()) {
      console.info(`[auth-email] ${subject} → ${to}`);
      return { ok: true as const, skipped: true };
    }
    return { ok: false as const, error: "Email is not configured." };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: fromAddress()!,
    to,
    subject,
    html,
  });
  if (result.error) return { ok: false as const, error: result.error.message };
  return { ok: true as const, skipped: false };
}

function wrap(title: string, body: string) {
  return `<!doctype html>
<html><body style="margin:0;background:#f5f0e6;font-family:Georgia,serif;color:#151515">
  <div style="max-width:520px;margin:32px auto;padding:32px 28px;background:#fffdf8;border:1.5px solid #151515">
    <p style="font:900 11px Arial;letter-spacing:.16em;margin:0 0 18px">STICKIER™</p>
    <h1 style="font-size:32px;letter-spacing:-.04em;margin:0 0 16px">${title}</h1>
    ${body}
    <p style="font:12px Arial;color:#666;margin:28px 0 0">If you did not request this, you can ignore this email.</p>
  </div>
</body></html>`;
}

export async function sendVerificationEmail(to: string, verifyUrl: string) {
  return send(
    to,
    "Confirm your Stickier account",
    wrap(
      "Confirm your email.",
      `<p style="font:16px/1.55 Arial;color:#444">Tap the button to finish creating your Stickier account. This link expires in 24 hours.</p>
       <p style="margin:24px 0"><a href="${verifyUrl}" style="display:inline-block;background:#ff3b30;color:#fff;text-decoration:none;font:900 11px Arial;letter-spacing:.1em;padding:14px 18px">CONFIRM EMAIL</a></p>`
    )
  );
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  return send(
    to,
    "Reset your Stickier password",
    wrap(
      "Reset your password.",
      `<p style="font:16px/1.55 Arial;color:#444">Tap the button to choose a new password. This link expires in 1 hour and can only be used once.</p>
       <p style="margin:24px 0"><a href="${resetUrl}" style="display:inline-block;background:#151515;color:#fff;text-decoration:none;font:900 11px Arial;letter-spacing:.1em;padding:14px 18px">CHOOSE A NEW PASSWORD</a></p>`
    )
  );
}

export async function sendAlreadyRegisteredEmail(to: string, signInUrl: string) {
  return send(
    to,
    "Someone tried to create a Stickier account with this email",
    wrap(
      "You already have an account.",
      `<p style="font:16px/1.55 Arial;color:#444">A sign-up was attempted with this email. If that was you, sign in instead. If you forgot your password, you can reset it from the sign-in page.</p>
       <p style="margin:24px 0"><a href="${signInUrl}" style="display:inline-block;background:#151515;color:#fff;text-decoration:none;font:900 11px Arial;letter-spacing:.1em;padding:14px 18px">SIGN IN</a></p>`
    )
  );
}
