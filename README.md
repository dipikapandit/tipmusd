# TipMUSD

**One link. One QR code. Anyone can support you with MUSD.**

TipMUSD gives creators a permanent tip page (`/{username}`) and a QR code. A supporter opens the link, picks an amount and sends MUSD on **Mezo Testnet** straight from their wallet to the creator's wallet. The server checks every payment on chain before it counts.

- **Non-custodial.** A tip is a plain `MUSD.transfer(creator, amount)` signed by the supporter. TipMUSD never holds funds, never asks for keys and deploys no contract.
- **Verified, not trusted.** A tip only becomes `confirmed` after the server reads the receipt, decodes the MUSD `Transfer` log, and matches the recipient, the amount and the tip reference in the calldata.
- **Optional x402 rail.** AI agents and scripts can tip over HTTP with x402. The payer only signs and Mezo's facilitator pays gas. See [docs/X402.md](docs/X402.md).

> Testnet software. MUSD and BTC here have no value. Not affiliated with or endorsed by Mezo.

## How it works

```
Supporter's wallet ──MUSD.transfer(creator, amount) + 20-byte tip ref──▶ MUSD contract (Mezo Testnet)
        │                                                                     │ Transfer(from, to, value)
        └─ tx hash ─▶ POST /api/tips/{id}/submit ─▶ verifier reads receipt ◀──┘
                                                       │ chain 31611? MUSD? success? to == creator?
                                                       │ value == amount? calldata ref == this tip?
                                                       ▼
                                             tips.status = confirmed ─▶ creator dashboard
Indexer (worker / cron): scans MUSD Transfer logs to creator wallets → records tips made outside the app.
```

**Tip reference.** The app appends 20 bytes (`"tipm"` + a 16-byte random ref) to the transfer calldata. MUSD ignores trailing calldata; we checked this on testnet, and the transfer still returns `true` for about 324 extra gas. The ref proves that the wallet which signed the transaction created this tip, so nobody can attach their own name or message to someone else's payment. Messages are never put on chain; they are stored off-chain next to the verified transaction.

**Status model:** `created → awaiting_wallet → submitted → pending_confirmation → confirmed | failed | expired`. Only `confirmed` counts anywhere.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What's new in v2: the social tipping layer for Mezo
- **Tip in MUSD or MEZO.** Supporters pick the token; creators can switch MEZO off. Both are verified the same way, and totals are always kept per token.
- **No MUSD? Pay with your Bitcoin, through Mezo**, right on the tip page:
  - swap a little BTC for MUSD on Mezo pools;
  - borrow a little more on an existing Mezo loan (blocked below 150%);
  - open a Mezo loan (minimum 1,800 MUSD, said plainly, confirmation required; the leftover MUSD stays in the wallet).

  The server checks the funding transaction on chain (right Mezo contract, success, MUSD to the tipper, before the tip). Only then does a tip count as "funded from Bitcoin via Mezo".
- **Social layer:** `/explore` shows network totals, a creator directory and a live feed of public tips. `/supporter/{address}` shows the creators an address has backed. Each tip page lists its top supporters. Anonymous tips and private creators are always excluded.

Verified on testnet (2026-11-13):
- MEZO accepts the tip reference tag.
- Mezo Borrow: minNetDebt is 1,800 MUSD, gas compensation 200 MUSD.
- A 0.0001 BTC → MUSD swap quote on the MUSD/BTC pool returns about 7.8 MUSD.
- Bytecode selectors: `openTrove` 0x2f3a6d98, `withdrawMUSD` 0xaf8b4fd0, `swapExactTokensForTokens` 0xcac88ea9.

## Features
- **Wallets via Mezo Passport:**
  - **Bitcoin wallets** (Unisat, OKX, Xverse): you sign with your Bitcoin key, and a Mezo smart account tied to it holds the MUSD and sends the tip.
  - **Ethereum wallets:** MetaMask, Rabby, any browser wallet, and WalletConnect when `NEXT_PUBLIC_WC_PROJECT_ID` is set.
  - On a phone with no wallet (e.g. inside the X app), the page offers to open itself in a wallet app.
- **Sign-in:** wallet sign-in (SIWE, single-use expiring nonces, domain pinned, replay-proof). Smart-account signatures are checked on chain (ERC-1271 / ERC-6492). No email.
- **Creator profile:**
  - Username with live availability and reserved and impersonation names blocked. Old usernames redirect and can't be reclaimed.
  - Display name, bio, photo upload or preset, social links, accent colour.
  - Suggested amounts and a default amount, a thank-you message, privacy toggles (public activity, anonymous tips, messages).
- **Public tip page:**
  - Supporters choose a suggested or custom amount and can add a name, a message or tip anonymously.
  - Before signing they see the recipient wallet, the gas estimate in BTC, and their MUSD and BTC balances with plain shortfall messages.
  - Wrong-network detection and switching. A live status ending in a confirmed receipt with an explorer link.
  - A dynamic Open Graph image for every creator.
- **Link parameters:** `?amount=`, `?c=campaign`, `?src=`, `?msg=` are validated and can never change the recipient.
- **QR and sharing:** QR as PNG, SVG or a printable QR card. Native share, X, LinkedIn, Telegram, WhatsApp, campaign links and an embed snippet.
- **Dashboard:**
  - Confirmed totals, tips, unique supporters, pending count and recent activity.
  - Activity filters (all, confirmed, pending, failed) and a date range.
  - Analytics: average, largest, daily volume, and visits kept separate from supporters, by source.
  - Notifications.
- **Payout wallet change:** needs a signature from the new wallet. Past tips are never rewritten.
- **Indexer:** an idempotent MUSD `Transfer` indexer with a block-hash cursor and reorg rewind. It runs from a worker, a cron endpoint, or a throttled catch-up when the dashboard loads.
- **Abuse controls:** a report button, profile suspension (`scripts/admin.ts`), rate limits everywhere, sanitised text and https-only social links.

## Run locally

Requirements: Node 22+.

```bash
npm install
cp .env.example .env.local      # works as-is: empty DATABASE_URL → embedded PGlite in .data/pglite
npm run dev                     # http://localhost:3000
npm run worker                  # optional: indexer loop (use a real Postgres if you run web + worker together)
```

For Postgres locally, set `DATABASE_URL`. The schema applies itself on boot (`lib/server/db/schema.sql`, idempotent). See [.env.example](.env.example) for every variable.

### Set up a wallet for Mezo Testnet
1. Use a Bitcoin wallet (Unisat, OKX or Xverse) through Mezo Passport, or an Ethereum wallet such as MetaMask or Rabby (desktop). On a phone, open the tip link inside the wallet app's browser, or set `NEXT_PUBLIC_WC_PROJECT_ID` to enable WalletConnect.
2. When you connect, the app offers to add or switch to **Mezo Testnet**:

   | Setting | Value |
   |---|---|
   | Chain ID | 31611 |
   | RPC | `https://rpc.test.mezo.org` |
   | Currency | BTC |
   | Explorer | `https://explorer.test.mezo.org` |

3. Get testnet BTC (for gas) and MUSD from the [Mezo faucet](https://faucet.test.mezo.org).
4. MUSD token: `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (18 decimals).

### Create a tip link (creator)
`/start` → connect wallet → sign in (a signature, no transaction) → claim a username → add name, bio and photo → choose suggested amounts → your link is `/{username}`. The QR code and share buttons are on the done screen and under **Dashboard → Share**.

### Send MUSD (supporter)
Open `/{username}` → pick an amount → connect → review the recipient wallet, amount and gas → approve in the wallet → wait for **Confirmed** → open the explorer link.

### Verify a payment yourself
Every confirmed tip links to `https://explorer.test.mezo.org/tx/{hash}`. Check the MUSD `Transfer` event there: `from` is the supporter, `to` is the creator wallet shown on the tip page, and `value` is the amount. `GET /api/tips/{id}` shows the server's verification status and confirmations.

## Tests

```bash
npm test            # vitest: server (PGlite + fake chain), x402, UI helpers
npm run typecheck
npm run lint
npm run build
```

Current results (2026-11-10): **188 tests passing**. tsc, eslint and `next build` are clean. The server tests cover:
- sign-in: valid, bad signature, expired nonce, replay, wrong domain or chain
- usernames: reserved names, case-insensitive duplicates, retired aliases
- payout wallet change
- the full verification matrix: confirmed, reverted, wrong token, wrong recipient, amount mismatch, calldata-ref mismatch, duplicate tx hash, idempotent re-submit, concurrent verify, pending confirmations, expiry and timeout
- v2: MEZO tips, token isolation (a MUSD log can't confirm a MEZO tip), Bitcoin-funding verification (swap, loan draw, wrong contract, funding after the tip, smart-account nested), per-token dashboard, and social-page privacy
- Mezo Passport: smart-account sign-in, smart-account tips (nested call), and indexer binding by nested ref
- the indexer: idempotency, intent linking, transfers made outside the app, historical wallets, reorg rewind
- dashboard totals count confirmed tips only

**Not yet done:** browser click-through, live two-wallet testnet transfers, mobile and in-app-browser checks, and social preview checks. See *Known limitations*.

## Deploy
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) covers Neon Postgres, Vercel, and an indexer schedule (Render worker or external cron). No contract deployment is needed.

## x402 (optional)
`GET /api/x402/tip/{username}?amount=1.5` returns HTTP 402. An x402 client (`@x402/fetch`) signs a Permit2 authorisation, and Mezo's facilitator (`facilitator.vativ.io`) settles the MUSD **payer → creator** directly and pays the gas. We verify the settlement transaction on chain before recording a tip with `source = x402`. It is off unless `X402_ENABLED=1`.

```bash
X402_PAYER_PRIVATE_KEY=0x... npx tsx scripts/x402-tip.ts https://<app> <username> 1.5 "thanks!"
```

Details, risks and the agent example: [docs/X402.md](docs/X402.md). Developer pages: `/developers` and `/dashboard/developers`.

## Project layout
```
app/                   pages (landing, /start, /[username], /tip/[id], /dashboard/*, /developers) + app/api routes
components/            UI (tip flow, dashboard, onboarding, wallet, x402)
lib/chain/             FROZEN chain + MUSD config, ERC-20 ABI
lib/api-types.ts       FROZEN wire contract between UI and API
lib/server/            auth, profiles, tips, verify, indexer, dashboard, x402/
lib/server/db/         schema.sql (FROZEN), postgres.js / PGlite driver
worker/run.ts          indexer + sweep loop
scripts/               admin.ts (suspend/reports), x402-tip.ts
tests/                 server/, x402/, ui/
```

## Known limitations
- **Smart accounts:** Mezo Passport smart accounts are supported. The transfer call, tip reference included, is found nested inside the account's transaction, and the MUSD `Transfer` log is still what proves the payment. Other smart wallets that rewrite the call data can't be matched to their tip; the indexer still records the transfer, without the name or message.
- **x402 and Passport:** gasless x402 tipping needs a plain-key signature, so it is hidden for Passport Bitcoin wallets. They use the normal tip.
- **Privacy:** the blockchain is public. "Anonymous" hides your name and address on TipMUSD only; the transfer is visible on the explorer.
- **x402:** the facilitator is community-run and its signers hold little testnet BTC, so settlement can fail if they run out of gas. A wallet's first x402 payment leaves a Permit2 allowance in place.
- **Campaign links:** they can be turned off, but not renamed or deleted.
- **Pay with Bitcoin, not yet tried live:** the swap, loan-draw and loan-open transactions are unit-tested and their selectors are checked against testnet bytecode, but none has been signed end to end, and Passport smart accounts haven't been tried. Opening the minimum loan needs about 0.055 BTC.
- **MEZO via link:** `?token=MEZO` in a tip link isn't supported yet.
- **Not yet verified:** deployment, a live two-wallet transfer, and mobile wallet flows (see Tests).
