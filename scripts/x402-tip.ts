/**
 * Tip a TipMUSD creator over x402 (MUSD on Mezo Testnet) from a script or agent.
 *
 *   X402_PAYER_PRIVATE_KEY=0x… npx tsx scripts/x402-tip.ts <baseUrl> <username> <amount> [message]
 *   e.g. X402_PAYER_PRIVATE_KEY=0x… npx tsx scripts/x402-tip.ts http://localhost:3000 alice 1.5 "thanks for the post"
 *
 * Optional env: X402_PAYER_NAME (shown as the supporter name), MEZO_RPC_URL.
 *
 * The payer wallet needs MUSD only — no BTC for gas. It signs a Permit2 transfer (and, the first time, an EIP-2612
 * permit for Permit2); the facilitator submits it and pays the gas. The private key never leaves this process and is
 * never printed.
 */
import { createPublicClient, formatUnits, getAddress, http, parseUnits, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import type { PaymentRequirements } from "@x402/core/types";
import { MUSD, MUSD_DECIMALS, explorerTx, mezoTestnet } from "../lib/chain/config";

const NETWORK = "eip155:31611" as const;

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}\n`);
  console.error("usage: X402_PAYER_PRIVATE_KEY=0x… npx tsx scripts/x402-tip.ts <baseUrl> <username> <amount> [message]");
  process.exit(2);
}

async function main() {
  const [baseUrlArg, username, amount, ...messageParts] = process.argv.slice(2);
  if (!baseUrlArg || !username || !amount) usage();
  const pk = (process.env.X402_PAYER_PRIVATE_KEY || "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) usage("X402_PAYER_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) usage("amount must be a MUSD decimal like 1.5");

  const baseUrl = baseUrlArg.replace(/\/+$/, "");
  const amountRaw = parseUnits(amount, MUSD_DECIMALS);
  const rpcUrl = process.env.MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0];
  const account = privateKeyToAccount(pk as Hex);
  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(rpcUrl) });

  // Cross-check the creator's public payout wallet so a misconfigured/hostile server can't redirect the payment.
  let expectedPayTo: string | null = null;
  try {
    const r = await fetch(`${baseUrl}/api/creators/${encodeURIComponent(username)}`);
    if (r.ok) expectedPayTo = getAddress(((await r.json()) as { recipientWallet: string }).recipientWallet);
  } catch {
    /* fall through */
  }
  if (!expectedPayTo) console.warn("warning: could not read the creator's public profile; payTo will not be cross-checked");

  const balance = await publicClient
    .readContract({
      address: MUSD,
      abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "balanceOf",
      args: [account.address],
    })
    .catch(() => null);
  console.log(`payer   ${account.address}${balance !== null ? `  (${formatUnits(balance, MUSD_DECIMALS)} MUSD)` : ""}`);
  if (balance !== null && balance < amountRaw) {
    console.error(`error: payer has less than ${amount} MUSD. Get testnet MUSD at https://faucet.test.mezo.org`);
    process.exit(1);
  }

  // Only ever pay exactly this tip: MUSD on Mezo Testnet, this amount, (if known) this creator's wallet.
  const onlyThisTip = (_v: number, reqs: PaymentRequirements[]) =>
    reqs.filter(
      (r) =>
        r.network === NETWORK &&
        r.asset.toLowerCase() === MUSD.toLowerCase() &&
        r.amount === amountRaw.toString() &&
        (!expectedPayTo || r.payTo.toLowerCase() === expectedPayTo.toLowerCase()),
    );

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(toClientEvmSigner(account, publicClient), { rpcUrl }) }],
    policies: [onlyThisTip],
    spendControls: { allowedAssets: [{ network: NETWORK, asset: MUSD, maxAmountPerPayment: amountRaw.toString() }] },
  });

  const url = new URL(`${baseUrl}/api/x402/tip/${encodeURIComponent(username)}`);
  url.searchParams.set("amount", amount);
  const message = messageParts.join(" ").trim();
  if (message) url.searchParams.set("message", message);
  if (process.env.X402_PAYER_NAME) url.searchParams.set("name", process.env.X402_PAYER_NAME);

  console.log(`tipping ${amount} MUSD to @${username} via ${url.origin} …`);
  const res = await fetchWithPayment(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }

  const paymentResponse = res.headers.get("PAYMENT-RESPONSE");
  const settlement = paymentResponse ? decodePaymentResponseHeader(paymentResponse) : null;

  if (!res.ok) {
    console.error(`failed: HTTP ${res.status}`);
    console.error(JSON.stringify(body, null, 2));
    if (settlement?.transaction) console.error(`settlement tx: ${explorerTx(settlement.transaction)}`);
    process.exit(1);
  }

  const receipt = body as { tip: { id: string; status: string; txHash: string | null; explorerUrl: string | null } };
  console.log(JSON.stringify(body, null, 2));
  console.log(`\nstatus  ${receipt.tip.status}`);
  const tx = receipt.tip.txHash || settlement?.transaction;
  if (tx) console.log(`tx      ${explorerTx(tx)}`);
  console.log(`receipt ${baseUrl}/tip/${receipt.tip.id}`);
}

main().catch((e) => {
  // Never print the key: only the error message (viem/x402 errors don't include it).
  console.error("error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
