// Copy-paste snippets for the x402 tip endpoint (shared by /developers and /dashboard/developers).

export function endpointUrl(appUrl: string, username: string, amount = "1"): string {
  return `${appUrl.replace(/\/+$/, "")}/api/x402/tip/${encodeURIComponent(username)}?amount=${encodeURIComponent(amount)}`;
}

export function curlSnippet(appUrl: string, username: string, amount = "1"): string {
  return `# Ask for the price (answers 402 with the payment details)\ncurl -i "${endpointUrl(appUrl, username, amount)}"`;
}

export function scriptSnippet(appUrl: string, username: string, amount = "1"): string {
  return `X402_PAYER_PRIVATE_KEY=0x… npx tsx scripts/x402-tip.ts ${appUrl.replace(/\/+$/, "")} ${username} ${amount} "thanks!"`;
}

export function agentSnippet(appUrl: string, username: string, amount = "1"): string {
  return `import { createPublicClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";

const rpcUrl = "https://rpc.test.mezo.org";
const account = privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`);
const signer = toClientEvmSigner(account, createPublicClient({ transport: http(rpcUrl) }));
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";

const pay = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "eip155:31611", client: new ExactEvmScheme(signer, { rpcUrl }) }],
  spendControls: {
    allowedAssets: [{ network: "eip155:31611", asset: MUSD, maxAmountPerPayment: parseUnits("${amount}", 18).toString() }],
  },
});

const res = await pay("${endpointUrl(appUrl, username, amount)}&message=gm");
console.log(await res.json()); // { tip, settlement }`;
}
