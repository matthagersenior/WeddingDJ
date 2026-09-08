# WeddingDJ

A Cloudflare-native wedding song-request app for **Michael Higdon & Marisa Hager**. Guests open one wedding QR page, request songs, and can optionally boost a request. The couple/DJ runs the live queue from a host dashboard.

## Payment design

There is **no Stripe integration**.

- **Free** — normal song request.
- **$5 Priority Request** — moves ahead of free requests after payment is confirmed.
- **$10 Jump to Front** — highest boost tier after payment is confirmed.
- **Cash App direct** — the app opens the couple's real Cash App link and can display their real Cash App QR image. The guest includes the generated `DJ-XXXXXX` code in the payment note, then taps **I sent the Cash App payment**. The host confirms it with one tap.
- **Apple Pay / Google Pay / cards** — optional Square-hosted checkout. Square is not required for the rest of WeddingDJ to work.

Pending or failed payments never get paid queue priority.

## Stack

- Cloudflare Workers
- Cloudflare D1
- Durable Object + WebSocket live room per wedding
- Optional Spotify OAuth/search/playback controls
- Optional Square Checkout API for Apple Pay / Google Pay / cards

## Important wedding-day behavior

- Requests can be **active**, **paused**, or **closed** from the dashboard.
- Pausing is intended for speeches, first dance, father/daughter dance, cake cutting, and other formal moments.
- Clean-only, maximum duration, per-guest request limits, duplicate prevention, artist/track blocking, and manual defer/skip controls are enforced server-side.
- A paid boost changes priority only. It never guarantees playback.
- Keep a downloaded fallback playlist and a manual Spotify/device control path available in case venue internet is unreliable.

## 1. Install

```bash
npm install
npx wrangler login
```

## 2. Create the D1 database

```bash
npx wrangler d1 create the-wedding-dj
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing:

```text
REPLACE_WITH_YOUR_D1_DATABASE_ID
```

Then run:

```bash
npm run db:migrate:remote
```

For local development:

```bash
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open `http://localhost:8787/setup` to create the first host account. A signed-in host can add the second host from the dashboard.

## 3. Required secret

Generate a strong session secret:

```bash
openssl rand -hex 32
npx wrangler secret put SESSION_SECRET
```

Never commit secrets to GitHub or `wrangler.jsonc`.

## 4. Cash App configuration

Set the couple's actual Cash App profile URL, for example:

```text
https://cash.app/$YOUR_CASHTAG
```

Set `CASHAPP_URL` in `wrangler.jsonc` (it is not a secret).

For the QR shown on the boost screen, set `CASHAPP_QR_IMAGE_URL` to a public HTTPS image URL containing the couple's **real Cash App QR code**. Do not use an AI-generated QR image.

The QR and **Open Cash App** button are intentionally separate from Square so Cash App can route directly to the couple.

## 5. Optional Square wallet/card checkout

Square is only for guests who prefer Apple Pay, Google Pay, or a debit/credit card.

Create a Square application and obtain its location ID. Then add:

```bash
npx wrangler secret put SQUARE_ACCESS_TOKEN
npx wrangler secret put SQUARE_LOCATION_ID
npx wrangler secret put SQUARE_WEBHOOK_SIGNATURE_KEY
```

Set `SQUARE_ENVIRONMENT` to `sandbox` while testing and `production` only when ready.

Create a Square webhook subscription for:

```text
https://YOUR-WORKER.workers.dev/api/square/webhook
```

Subscribe to `payment.created` and `payment.updated`.

WeddingDJ creates a Square-hosted payment link per boost and requests Apple Pay, Google Pay, and card checkout. Cash App Pay is disabled in that Square checkout intentionally because the app has its own direct Cash App route.

## 6. Optional Spotify

```bash
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
```

Register this redirect URI in the Spotify developer dashboard:

```text
https://YOUR-WORKER.workers.dev/auth/spotify/callback
```

The host dashboard can then connect Spotify. Guests can search Spotify when connected; manual song entry still works without Spotify.

## 7. Deploy

```bash
npm run deploy
```

After the first deploy, update `APP_URL` in `wrangler.jsonc` to the real HTTPS Worker/custom-domain URL and deploy again.

The wedding guest URL is:

```text
https://YOUR-WORKER.workers.dev/e/michael-marisa
```

That is the URL to encode into the **main wedding table QR**. Guests should land in WeddingDJ first; the Cash App QR appears only when they choose a paid boost.

## GitHub Actions

`CI` type-checks every push/PR.

A manual **Deploy WeddingDJ** workflow is included. Before using it, add these GitHub repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The Cloudflare token should be scoped to the minimum permissions needed to deploy this Worker and work with its bound resources.

## Before the reception

1. Test the exact reception laptop/phone, browser, Wi-Fi/hotspot, audio adapter, mixer/speakers, and Spotify account.
2. Test a free request, a $5 Cash App boost, a $10 Cash App boost, and host confirmation.
3. If Square is enabled, test Apple Pay and Google Pay on real supported devices before switching from sandbox to production.
4. Verify pause/resume/close requests during formal moments.
5. Print the main WeddingDJ QR on table cards and signage.
6. Keep a downloaded fallback playlist and direct manual playback controls ready.
