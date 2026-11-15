# TipMUSD — Architecture (FROZEN)

One link, one QR code: anyone can tip a creator in MUSD on Mezo Testnet. Non-custodial: the supporter's wallet
sends `MUSD.transfer(creatorWallet, amount)` directly. The platform never holds funds or keys and never deploys a
contract. The chain is the source of truth; the database stores verified metadata.

## Verified facts (2026-11-10)
- Mezo Testnet chain id 31611 (`eth_chainId` = 0x7b7b), RPC `https://rpc.test.mezo.org`, explorer `https://explorer.test.mezo.org`, gas = native BTC (18 dec).
- MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`, 18 decimals, standard ERC-20 `Transfer`, EIP-2612 permit (domain "Mezo USD"/"1"). **No EIP-3009.**
- Trailing calldata after `transfer(to,amount)` is accepted: `eth_call` returns `true`, `eth_estimateGas` 0x8611 → 0x8745 (+324 gas) with a 20-byte suffix.
- x402: Mezo docs (mezo.org/docs/developers/getting-started/musd-payments-x402) list the community facilitator `https://facilitator.vativ.io` (`/supported` → x402 v2, scheme `exact`, `eip155:31611`, extension `eip2612GasSponsoring`). MUSD x402 payments settle through Permit2 (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) + the x402 proxy `0x402085c248EeA27D92E8b30b2C58ed07f9E20001`. SDK: `@x402/core|evm|next|fetch|extensions` v2 (≥ 2.10 for Mezo testnet).

## Stack
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 + shadcn-style primitives (components/ui) · motion · TanStack Query · react-hook-form + zod · viem + wagmi 2 + Mezo Passport 0.17 (RainbowKit 2: Bitcoin wallets via Mezo smart accounts, connector type "orangekit"; Ethereum wallets; WalletConnect when `NEXT_PUBLIC_WC_PROJECT_ID` set) · Postgres via postgres.js (Neon in prod) with PGlite fallback locally · vitest.

## Payment lifecycle (app tips)
1. `POST /api/tips` → server loads creator (DB, never URL), validates amount, creates `tips` row `created` with random 16-byte `ref`, `expected_amount_raw`, `recipient_address`, `expires_at = now + 30m`. Returns `payment { chainId, token, recipient, amountRaw, dataSuffix }`.
2. UI shows review: recipient wallet (checksummed), amount, est. BTC gas, balances (MUSD + BTC). Checks chain = 31611 (switch first, never send on another chain).
3. UI `PATCH status=awaiting_wallet`, then `writeContract(MUSD.transfer, { dataSuffix })`. Rejection → `PATCH status=failed reason=user_rejected`.
4. Hash → `POST /api/tips/{id}/submit` → `submitted` (unique tx hash; a hash already bound elsewhere → 409 `duplicate_tx`). One inline verification attempt.
5. Verification (`lib/server/verify.ts`, server-only, trusts nothing from the client): receipt on chain 31611; `status=success` else `failed/reverted`; tx `input` must be `transfer(...)`++`dataSuffix(ref)` to the MUSD contract (binds tx ↔ intent); find the MUSD `Transfer` log (address == MUSD, topic0 == Transfer, `to` == intent recipient); `value` == expected (else `failed/amount_mismatch`); confirmations ≥ `CONFIRMATIONS` (default 1) else `pending_confirmation`; then atomically set `confirmed`, `amount_raw`, `sender_address` (= log `from`), `log_index`, block, timestamp, `verified_at`, upsert `blockchain_events`, create the creator notification. Updates are conditional (`WHERE status NOT IN terminal`) so concurrent verifiers are idempotent.
6. No receipt after 30 min → `failed/timeout` (indexer can still record the transfer later, without message). Intents never submitted → `expired`.
7. `GET /api/tips/{id}` re-verifies non-terminal tips (throttled per tip) so the success screen and dashboard converge without a worker.

Mezo Passport smart accounts: the outer tx targets the account, so the verifier instead requires the exact `transfer(recipient, amount) ++ suffix` bytes nested (byte-aligned) in the tx input AND a MUSD Transfer log to the recipient; sender = the log's `from` (the smart account). The indexer finds nested refs the same way (`embeddedRefs`). Other wallets that rewrite call data: no match → the indexer records the transfer without name/message. x402 is hidden for smart accounts (MUSD permit / Permit2 need an ECDSA signature).

## Indexer (`lib/server/indexer.ts`)
Scans MUSD `Transfer` logs in ranges ≤ 2,000 blocks from cursor `musd_transfers` (start = `INDEXER_START_BLOCK` or head−5,000 on first run), filters `to` ∈ creator wallets (current + `creator_wallets` history). For each log: insert `blockchain_events` ON CONFLICT DO NOTHING; if a tip with that tx hash exists → run the verifier on it; else insert a `confirmed` tip with `source='indexer'` (after confirmations). Cursor stores block hash; on mismatch rewind `REORG_WINDOW` blocks (Mezo has fast finality; the check is defensive). Runs from: `worker/run.ts` (Render/any Node host), `POST /api/indexer/sync` with `Bearer INDEXER_SECRET` (external cron), and a throttled catch-up on dashboard load. A pg advisory lock prevents concurrent runs.

## x402 (`lib/server/x402/*`, `app/api/x402/*`)
Optional machine-payment rail for agents/bots/scripts: `GET /api/x402/tip/{username}?amount=` answers 402 with `payTo = creator wallet`, `price = amount MUSD` on `eip155:31611`; client pays with `@x402/fetch` (signature only; facilitator pays gas, settles payer → creator via Permit2). After settlement we verify the settlement tx on chain (Transfer log payer → creator wallet, value == amount) before recording a `confirmed` tip with `source='x402'`. Disabled unless `X402_ENABLED=1`. The ordinary tip page never depends on it.

## Security
SIWE (EIP-4361) nonce auth: single-use, 10-min nonces, domain pinned to `NEXT_PUBLIC_APP_URL` in prod, statement + chain checked, ERC-1271/6492 fallback; HMAC-signed httpOnly SameSite=Lax cookie; Origin check on mutations; DB-backed rate limits; zod on every input; text sanitised (control chars stripped, trimmed, length-capped, rendered as text — never HTML); social links https-only with per-kind host allowlist; avatar uploads magic-byte checked; reserved usernames (`lib/usernames.ts`); payout wallet change needs a fresh signature from the NEW wallet (`wallet_change` nonce) and notifies; retired usernames can't be reclaimed; report button + `status='suspended'` hides a profile.

## Routes
Pages: `/` landing · `/start` onboarding (connect → sign → claim username → profile → share) · `/dashboard` (overview) · `/dashboard/activity` · `/dashboard/share` (link, QR, campaigns, embed) · `/dashboard/analytics` · `/dashboard/settings` · `/dashboard/developers` (x402) · `/{username}` public tip page (+ `opengraph-image`) · `/tip/{id}` receipt · `/developers` (public x402 docs) · 404/error.

## File ownership
| Area | Owner | Files |
|---|---|---|
| Frozen contracts | Architect | `lib/chain/{config,abis}.ts`, `lib/api-types.ts`, `lib/server/db/schema.sql`, `lib/usernames.ts`, this doc |
| Backend + payments + indexer | Agent B | `lib/server/**` (except `x402/`), `app/api/**` (except `x402/`), `worker/**`, `tests/server/**`, `render.yaml` |
| Frontend + design | Agent F | `app/**` pages/layouts/metadata/OG/icons (not `app/api`), `components/**`, `hooks/**`, `lib/client/**`, `public/**`, `tests/ui/**` |
| x402 | Agent X | `lib/server/x402/**`, `app/api/x402/**`, `scripts/x402-*.ts`, `docs/X402.md`, `components/x402/**` (+ the `/developers` and `/dashboard/developers` page files) |
| Integration, README, deploy | Architect | `README.md`, `docs/DEPLOYMENT.md`, `.env.example`, `package.json` deps (agents may add deps they need) |

## v2 (2026-11-13): social tipping layer on Mezo
Positioning: **TipMUSD is the social tipping layer for Mezo.** Anyone can be tipped in MUSD or MEZO through one link, and supporters who only hold Bitcoin can fund a tip from their BTC via Mezo pools or Mezo Borrow without leaving the page.

### MEZO tips
`CreateTipRequest.token = "MEZO"` (creator `acceptMezo`, default on). Same flow and verifier: `MEZO.transfer(recipient, amount) ++ suffix` (MEZO accepts trailing calldata, verified). `tips.token_address` is the token; the verifier looks for the Transfer log **of that token**. The indexer scans Transfer logs of both MUSD and MEZO (one cursor per token: `musd_transfers`, `mezo_transfers`). MEZO amounts use `TIP_TOKENS.MEZO` limits and presets (no USD peg, so no creator-defined MEZO amounts). Totals are always kept per token and never added together.

### Fund your tip from Bitcoin (client-side txs, signed by the supporter)
Shown when the supporter's MUSD balance is short for a MUSD tip:
1. **Swap a little BTC → MUSD** on Mezo pools: `BTC.approve(router, x)` then `router.swapExactTokensForTokens(x, minOut, [{from: BTC, to: MUSD, stable: false, factory}], to=self, deadline)`, quoted with `getAmountsOut`, `DEFAULT_SLIPPAGE_BPS` slippage, and enough MUSD for the tip plus a small buffer.
2. **Draw from an existing Mezo loan**: `BorrowerOperations.withdrawMUSD(amount, upperHint, lowerHint)`, only if a trove is active and the ICR after the draw stays ≥ 150% (UI guard, well above the 110% MCR).
3. **Open a Mezo loan**: `openTrove(debt ≥ MIN_NET_DEBT, upperHint, lowerHint)` with BTC as msg.value at `SAFE_RATIO_PERCENT`, using hints from HintHelpers/SortedTroves. The UI explains the 1,800 MUSD minimum plainly; whatever isn't tipped stays in the supporter's wallet. The full loan dashboard is linked at testnet.mezo.org.

After funding, the tip proceeds normally. `POST /api/tips/{id}/submit { txHash, funding: { kind, txHash } }`. When the tip is confirmed, the server verifies the funding tx: receipt success; `tx.to` = router (swap_btc) or BorrowerOperations (loan_*) — or, for a Passport smart account, the matching calldata nested in the input; and for swaps, a MUSD Transfer log **to** the tip sender. Only then `funding_verified = TRUE`. Unverified funding is never shown publicly and never counted.

### Social layer
- `/explore`: network totals (per token, plus the number of tips funded from Bitcoin), creators sorted by supporters or most recent, and a live feed of public tips.
- `/supporter/[address]`: the creators an address has backed publicly, with totals per token.
- Top supporters on each tip page.
- Privacy: only confirmed tips to active creators with public activity; anonymous tips and private-activity creators are excluded everywhere.

### v2 ownership
| Area | Owner | Files |
|---|---|---|
| Frozen v2 contracts | Architect | `lib/chain/config.ts` v2 block, `lib/api-types.ts`, `schema.sql` v2 block, this section |
| Backend v2 | Agent B2 | `lib/server/**` (incl. `x402/record.ts` for the TipView fields), `app/api/**`, `worker/**`, `tests/server/**`, `tests/x402/**` |
| Frontend v2 | Agent F2 | `app/**` pages, `components/**`, `hooks/**`, `lib/client/**` (incl. new `lib/client/mezo/` for swap + borrow tx builders), `tests/ui/**` |
