# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter originally avoided `wrangler.jsonc`. Stickier now includes `wrangler.jsonc` so the same D1 and R2 bindings can be deployed on Cloudflare Workers. OpenAI Sites still reads `.openai/hosting.json`.

## Production secrets

Set each secret in a local `.env` file (gitignored) and with `wrangler secret put <NAME>` for production:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SESSION_SECRET` — signs session cookies, email links, and photo-upload tokens
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile bot protection
- `APP_ORIGIN` — canonical site origin used in auth emails (defaults to `https://stickier.app` in production)

Optional: `STRIPE_PRICE_ID`, `STRIPE_SUBSCRIPTION_PRICE_ID`, `OPENAI_IMAGE_MODEL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

Local development can use Cloudflare’s always-pass Turnstile test keys (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`). Replace them with a real widget before production.

Run `npm run dev` to build once and start both the Vite frontend on port 5173 and
the Wrangler API worker on port 8788. The launcher stops both processes together
if either exits. Stop it before running `npm run build`; the build guard prevents
Wrangler from reloading a partially written server bundle.

Forward Stripe test webhooks with `npm run dev:webhooks` while `npm run dev` is running.

## Architecture

- **Config**: `wrangler.jsonc` is the single source of truth for bindings and
  compatibility. The Vite plugin auto-discovers it; do not duplicate bindings in
  `vite.config.ts`.
- **Auth**: identity is an HMAC-signed session cookie (`SESSION_SECRET`). Email and
  password sign-up / sign-in are the production path (`/signup`, `/signin`). New
  accounts confirm email through Resend. The OpenAI Sites `oai-authenticated-user-*`
  headers remain only a sign-in hint, never trusted on their own. Users carry a
  surrogate ID; orders, subscriptions and generations link to it.
- **Generation**: `POST /api/generate-stickers` validates, runs Turnstile and
  moderation, reserves quota, and enqueues a job on the `GENERATION_QUEUE`
  Cloudflare Queue. The Worker `queue` consumer calls OpenAI and writes the
  sheet to R2; the browser polls `/api/generation-status`.
- **Uploads**: photos go straight to R2 via `/api/upload-photo` (signed,
  short-lived tokens), not through a JSON body.
- **Billing**: Stripe webhooks populate `orders`/`subscriptions`; reads
  (`/api/checkout-status`, `/api/download-stickers`) are served from D1.

## Provision Cloudflare resources

```bash
wrangler d1 migrations apply stickier-db --remote
wrangler queues create stickier-generation
wrangler queues create stickier-generation-dlq
```

The D1 database (`stickier-db`), R2 bucket (`stickier-assets`), Images binding,
and three rate-limit namespaces are declared in `wrangler.jsonc`. Add an R2
lifecycle rule to expire the `uploads/` prefix (reference photos) after 24 hours.

Point Stripe webhooks at `/api/webhooks/stripe` for `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, and `customer.subscription.deleted`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` defines users, subscriptions, orders, generations, stripe events, and rate limits
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with
  `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper
  module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can
  prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned
  `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: build once, then start the Vite frontend and Wrangler API worker together
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
# Stickier
