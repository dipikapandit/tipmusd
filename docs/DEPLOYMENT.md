# Deploying TipMUSD to Mezo Testnet

No smart contract is deployed. TipMUSD uses the existing MUSD token, so deploying means: a database, the web app, and something that runs the indexer on a schedule.

## 1. Database (Neon or any Postgres 13+)
1. Create a project and copy the **pooled** connection string (`...-pooler...?sslmode=require`).
2. Nothing else to do. The schema in `lib/server/db/schema.sql` is idempotent and is applied on the first request, under an advisory lock.

## 2. Web app (Vercel)
1. Import the repo. The framework is Next.js and the build command stays at the default (`next build`).
2. Set the env vars from `.env.example`. These are the minimum:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` (exact host; sign-in messages are pinned to it) |
| `DATABASE_URL` | Neon pooled URL |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `INDEXER_SECRET`, `CRON_SECRET` | `openssl rand -hex 24` each |
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect Cloud project id (for mobile wallets) |
| `SIWE_EXTRA_DOMAINS` | optional: the `*.vercel.app` host, if you also sign in there |
| `X402_ENABLED` | `1` to turn on the x402 rail (optional) |

3. Deploy, then check `GET /api/health`. It should return `ok: true`, `chainId: 31611` and a recent block.

## 3. Indexer schedule (pick one)
A tip made in the app is verified at the moment it is submitted, and again whenever someone views it. The indexer is what records MUSD sent to a creator's wallet without going through the app, and it also cleans up expired intents.
- **Render worker:** `render.yaml` starts `npm run worker`, which loops every `WORKER_INTERVAL_MS`. Give it the same `DATABASE_URL` and chain vars as the web app.
- **External cron** (GitHub Actions, cron-job.org): every 1–5 minutes, run
  `curl -X POST -H "Authorization: Bearer $INDEXER_SECRET" https://<domain>/api/indexer/sync`
  and `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron`.
- **Vercel Cron:** `GET /api/cron` accepts Vercel's `Authorization: Bearer $CRON_SECRET`. The Hobby plan only allows daily runs, so pair it with one of the options above.

The creator dashboard also triggers a throttled catch-up sync whenever it loads.

## 4. Verify the deployment
Follow the two-wallet demo in the README (Scenarios A–E). Record the tx hashes and the explorer links in `docs/TESTNET_EVIDENCE.md`.

## Security notes
- Never put private keys on the server. The app never needs one.
- `X402_PAYER_PRIVATE_KEY` is only for running `scripts/x402-tip.ts` locally.
- Suspend abusive profiles with `npx tsx scripts/admin.ts suspend <username>`. It needs `DATABASE_URL`.
