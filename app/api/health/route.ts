export async function GET() {
  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    stripe: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL),
  };
  const ready = Object.values(checks).every(Boolean);
  return Response.json({ ok: ready, checks, time: new Date().toISOString() }, { status: ready ? 200 : 503 });
}
