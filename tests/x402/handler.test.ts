import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import type { X402TipReceipt } from "@/lib/api-types";
import { MUSD, MEZO_TESTNET_ID } from "@/lib/chain/config";
import type { Sql } from "@/lib/server/db";
import { handleX402Tip, type X402Deps } from "@/lib/server/x402/handler";
import { createX402HttpServer } from "@/lib/server/x402/server";
import { sweepPendingX402Tips, verifyX402Tip } from "@/lib/server/x402/verify";
import { freshTestDb } from "./db";
import { CREATOR_WALLET, FakeChain, FakeFacilitator, PAYER, TX, TX2, transferLog } from "./fakes";

const BASE = "http://localhost:3000/api/x402/tip";
const AMOUNT = 2n * 10n ** 18n;

let sql: Sql;
let chain: FakeChain;
let facilitator: FakeFacilitator;
let deps: X402Deps;
let creatorId: string;

async function seedCreator(db: Sql, opts: { messagesEnabled?: boolean } = {}) {
  const [u] = await db<{ id: string }>`INSERT INTO users (wallet_address) VALUES (${CREATOR_WALLET}) RETURNING id`;
  const [c] = await db<{ id: string }>`
    INSERT INTO creator_profiles (user_id, username, display_name, recipient_wallet, thank_you_message, messages_enabled)
    VALUES (${u.id}, 'alice', 'Alice', ${CREATOR_WALLET}, 'Thanks!', ${opts.messagesEnabled ?? true}) RETURNING id`;
  return c.id;
}

function get(path: string, headers: Record<string, string> = {}) {
  return new Request(`${BASE}/${path}`, { headers: { "x-real-ip": "10.0.0.1", ...headers } });
}

async function paymentRequired(path: string): Promise<PaymentRequired> {
  const res = await handleX402Tip(get(path), "alice", deps);
  expect(res.status).toBe(402);
  return decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED")!);
}

/** Simulates what @x402/fetch sends back: the accepted requirement + an (opaque) signed payload. */
async function pay(path: string): Promise<Response> {
  const pr = await paymentRequired(path);
  const sig = encodePaymentSignatureHeader({
    x402Version: 2,
    resource: pr.resource,
    accepted: pr.accepts[0],
    payload: { signature: "0x" + "11".repeat(65), permit2Authorization: { from: PAYER } },
  });
  return handleX402Tip(get(path, { "PAYMENT-SIGNATURE": sig }), "alice", deps);
}

beforeAll(() => {
  process.env.X402_ENABLED = "1";
  process.env.X402_RATE_LIMIT_PER_MINUTE = "1000";
  process.env.CONFIRMATIONS = "2";
});

beforeEach(async () => {
  sql = await freshTestDb();
  creatorId = await seedCreator(sql);
  chain = new FakeChain();
  facilitator = new FakeFacilitator();
  const server = createX402HttpServer(facilitator);
  await server.initialize();
  deps = { sql, chain, getServer: async () => server, settleCheck: { attempts: 1, delayMs: 0 } };
}, 60_000); // a fresh PGlite per test can be slow while the whole suite runs in parallel

describe("GET /api/x402/tip/{username}", () => {
  it("is 404 x402_disabled unless X402_ENABLED=1", async () => {
    process.env.X402_ENABLED = "0";
    try {
      const res = await handleX402Tip(get("alice?amount=1"), "alice", deps);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("x402_disabled");
    } finally {
      process.env.X402_ENABLED = "1";
    }
  });

  it("validates before asking for payment", async () => {
    let res = await handleX402Tip(get("alice?amount=abc"), "alice", deps);
    expect(res.status).toBe(400);
    expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
    res = await handleX402Tip(get("alice?amount=0.001"), "alice", deps);
    expect((await res.json()).error.code).toBe("amount_out_of_range");
    res = await handleX402Tip(get("nobody?amount=1"), "nobody", deps);
    expect(res.status).toBe(404);
  });

  it("does not serve suspended creators", async () => {
    await sql`UPDATE creator_profiles SET status = 'suspended'`;
    const res = await handleX402Tip(get("alice?amount=1"), "alice", deps);
    expect(res.status).toBe(404);
  });

  it("402 derives payTo from the DB and price as exact MUSD base units (query payTo ignored)", async () => {
    const pr = await paymentRequired("alice?amount=2&payTo=0x000000000000000000000000000000000000dEaD");
    expect(pr.x402Version).toBe(2);
    expect(pr.accepts).toHaveLength(1);
    const a = pr.accepts[0];
    expect(a.network).toBe(`eip155:${MEZO_TESTNET_ID}`);
    expect(a.scheme).toBe("exact");
    expect(a.payTo.toLowerCase()).toBe(CREATOR_WALLET);
    expect(a.asset).toBe(MUSD);
    expect(a.amount).toBe(AMOUNT.toString());
    expect(a.extra).toMatchObject({ name: "Mezo USD", version: "1", assetTransferMethod: "permit2" });
    expect(pr.extensions).toHaveProperty("eip2612GasSponsoring");
    expect(facilitator.verifyCalls).toBe(0);
  });

  it("settles, verifies on chain, records a confirmed x402 tip and returns the receipt", async () => {
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT, 4)]);
    const res = await pay("alice?amount=2&name=%20Bot%E2%80%AE&message=gm");
    expect(res.status).toBe(200);
    const body = (await res.json()) as X402TipReceipt;
    expect(body.settlement).toEqual({ transaction: TX, network: "eip155:31611", payer: expect.stringMatching(/^0x1111/i) });
    expect(body.tip).toMatchObject({
      status: "confirmed",
      source: "x402",
      amountRaw: AMOUNT.toString(),
      expectedAmountRaw: AMOUNT.toString(),
      supporterName: "Bot",
      message: "gm",
      txHash: TX,
      thankYouMessage: "Thanks!",
      creatorUsername: "alice",
    });
    expect(decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE")!).transaction).toBe(TX);

    const [ev] = await sql<{ tip_id: string; value_raw: string }>`SELECT tip_id, value_raw FROM blockchain_events`;
    expect(ev.tip_id).toBe(body.tip.id);
    const notes = await sql`SELECT * FROM notifications WHERE tip_id = ${body.tip.id}`;
    expect(notes).toHaveLength(1);
  });

  it("drops the message when the creator disabled messages", async () => {
    await sql`UPDATE creator_profiles SET messages_enabled = false`;
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT)]);
    const body = (await (await pay("alice?amount=2&message=hello")).json()) as X402TipReceipt;
    expect(body.tip.message).toBeNull();
  });

  it("does not record a tip when settlement fails at the facilitator", async () => {
    facilitator.settleResult = { success: false, transaction: "", errorReason: "insufficient_funds" };
    const res = await pay("alice?amount=2");
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("x402_settlement_failed");
    expect(body.error.message).toMatch(/gas/);
    expect(await sql`SELECT id FROM tips`).toHaveLength(0);
  });

  it("does not record a tip when the settlement tx doesn't pay the creator the exact amount", async () => {
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT - 1n)]);
    const res = await pay("alice?amount=2");
    expect(res.status).toBe(502);
    expect((await res.json()).error.details.reason).toBe("amount_mismatch");
    expect(await sql`SELECT id FROM tips`).toHaveLength(0);
  });

  it("a replayed settlement tx hash links to the same tip (no duplicate)", async () => {
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT)]);
    const a = (await (await pay("alice?amount=2")).json()) as X402TipReceipt;
    const b = (await (await pay("alice?amount=2")).json()) as X402TipReceipt;
    expect(b.tip.id).toBe(a.tip.id);
    expect(await sql`SELECT id FROM tips`).toHaveLength(1);
    expect(await sql`SELECT id FROM blockchain_events`).toHaveLength(1);
  });

  it("links to (and enriches) a row the indexer inserted first", async () => {
    const [idx] = await sql<{ id: string }>`
      INSERT INTO tips (creator_id, source, status, chain_id, token_address, recipient_address, amount_raw, sender_address, tx_hash, log_index, block_number)
      VALUES (${creatorId}, 'indexer', 'confirmed', ${MEZO_TESTNET_ID}, ${MUSD.toLowerCase()}, ${CREATOR_WALLET}, ${AMOUNT}, ${PAYER}, ${TX}, 0, 90)
      RETURNING id`;
    await sql`
      INSERT INTO blockchain_events (chain_id, transaction_hash, log_index, block_number, block_hash, contract_address, event_name, from_address, to_address, value_raw, tip_id)
      VALUES (${MEZO_TESTNET_ID}, ${TX}, 0, 90, ${"0x" + "ee".repeat(32)}, ${MUSD.toLowerCase()}, 'Transfer', ${PAYER}, ${CREATOR_WALLET}, ${AMOUNT}, ${idx.id})`;
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT, 0)]);
    const body = (await (await pay("alice?amount=2&message=late")).json()) as X402TipReceipt;
    expect(body.tip.id).toBe(idx.id);
    expect(body.tip).toMatchObject({ source: "x402", message: "late", status: "confirmed" });
    expect(await sql`SELECT id FROM tips`).toHaveLength(1);
    expect(await sql`SELECT id FROM blockchain_events`).toHaveLength(1);
  });

  it("records pending_confirmation when the receipt isn't visible yet, then the sweep confirms it", async () => {
    facilitator.settleResult = { success: true, transaction: TX2, payer: PAYER };
    const res = await pay("alice?amount=2&message=soon");
    expect(res.status).toBe(200);
    const body = (await res.json()) as X402TipReceipt;
    expect(body.tip.status).toBe("pending_confirmation");
    expect(body.tip.amountRaw).toBeNull();
    expect(await sql`SELECT id FROM notifications`).toHaveLength(0);

    expect(await verifyX402Tip(sql, chain, body.tip.id)).toBe("pending");
    chain.put(TX2, [transferLog(PAYER, CREATOR_WALLET, AMOUNT, 2)]);
    expect(await sweepPendingX402Tips(sql, chain)).toEqual({ checked: 1, confirmed: 1, failed: 0 });
    const [row] = await sql<{ status: string; amount_raw: string; log_index: number }>`SELECT status, amount_raw, log_index FROM tips WHERE id = ${body.tip.id}`;
    expect(row.status).toBe("confirmed");
    expect(String(row.amount_raw)).toBe(AMOUNT.toString());
    expect(await sql`SELECT id FROM notifications`).toHaveLength(1);
    // idempotent
    expect(await verifyX402Tip(sql, chain, body.tip.id)).toBe("skipped");
  });

  it("sweep fails a pending tip whose settlement tx turns out wrong", async () => {
    facilitator.settleResult = { success: true, transaction: TX2, payer: PAYER };
    const body = (await (await pay("alice?amount=2")).json()) as X402TipReceipt;
    chain.put(TX2, [], { status: "reverted" });
    expect(await verifyX402Tip(sql, chain, body.tip.id)).toBe("failed");
    const [row] = await sql<{ status: string; failure_reason: string }>`SELECT status, failure_reason FROM tips WHERE id = ${body.tip.id}`;
    expect(row).toEqual({ status: "failed", failure_reason: "reverted" });
  });

  it("rate limits per client IP", async () => {
    process.env.X402_RATE_LIMIT_PER_MINUTE = "2";
    try {
      await handleX402Tip(get("alice?amount=1"), "alice", deps);
      await handleX402Tip(get("alice?amount=1"), "alice", deps);
      const res = await handleX402Tip(get("alice?amount=1"), "alice", deps);
      expect(res.status).toBe(429);
    } finally {
      process.env.X402_RATE_LIMIT_PER_MINUTE = "1000";
    }
  });
});
