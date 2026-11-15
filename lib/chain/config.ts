// FROZEN. Single source of chain + token configuration. Never hardcode addresses or chain ids elsewhere.
import { defineChain, type Address } from "viem";

export const MEZO_TESTNET_ID = 31611 as const;

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MEZO_RPC_URL || "https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

/** Mezo Testnet MUSD. Verified on chain (name "Mezo USD", symbol MUSD, 18 decimals, EIP-2612 permit). */
export const MUSD_TESTNET: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
export const MUSD_DECIMALS = 18 as const;
export const MUSD_SYMBOL = "MUSD" as const;

const isAddr = (v: string | undefined): v is Address => Boolean(v && /^0x[0-9a-fA-F]{40}$/.test(v));
export const MUSD: Address = isAddr(process.env.NEXT_PUBLIC_MUSD_ADDRESS) ? process.env.NEXT_PUBLIC_MUSD_ADDRESS : MUSD_TESTNET;

/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export const EXPLORER = "https://explorer.test.mezo.org";
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const explorerToken = (a: string = MUSD) => `${EXPLORER}/token/${a}`;

/** Where testers get testnet BTC (gas) and MUSD. */
export const FAUCET_URL = "https://faucet.test.mezo.org";

/**
 * Tip reference appended to the ERC-20 transfer calldata (viem `dataSuffix`). MUSD's ABI decoder ignores trailing
 * bytes, so the transfer is unchanged; the suffix proves the wallet that signed the tx chose this tip intent, which is
 * what lets us attach the supporter's off-chain name/message safely. It carries NO message text.
 *   suffix = TIP_REF_MAGIC (4 bytes) ++ ref (16 bytes)  → 20 bytes, hex "0x" + 40 chars
 */
export const TIP_REF_MAGIC = "0x7469706d" as const; // "tipm"
export const TIP_REF_BYTES = 16 as const;
export const tipDataSuffix = (refHex32: string) => `${TIP_REF_MAGIC}${refHex32.replace(/^0x/, "")}` as `0x${string}`;

/** Product limits shared by UI and API. Amounts are decimal strings in MUSD. */
export const TIP_LIMITS = {
  MIN: "0.01",
  MAX: "10000",
  MAX_DECIMALS: 6,
  MAX_SUGGESTED: 6,
  DEFAULT_SUGGESTED: ["1", "5", "10", "25"],
  DEFAULT_AMOUNT: "5",
  MESSAGE_MAX: 280,
  NAME_MAX: 40,
  /** An intent with no tx hash after this is `expired`. */
  INTENT_TTL_SECONDS: 30 * 60,
  /** A submitted tx with no receipt after this is `failed` (the indexer can still pick it up later). */
  SUBMITTED_TIMEOUT_SECONDS: 30 * 60,
} as const;

/** Rough gas units for an ERC-20 transfer, used only to show an estimate before the wallet's own estimate. */
export const TRANSFER_GAS_ESTIMATE = 65_000n;

// ---------------------------------------------------------------- v2: MEZO tips + Bitcoin funding (verified 2026-11-13)

/** MEZO, Mezo's native token: an ERC-20 precompile on testnet (18 decimals, standard Transfer events, accepts the
 *  20-byte tip suffix: eth_call true, estimateGas 25,336 → 26,244). BTC is also an ERC-20 precompile (18 dec). */
export const MEZO_TOKEN: Address = "0x7B7c000000000000000000000000000000000001";
export const BTC_TOKEN: Address = "0x7b7C000000000000000000000000000000000000";

export type TipTokenSymbol = "MUSD" | "MEZO";
export interface TipTokenInfo {
  symbol: TipTokenSymbol;
  name: string;
  address: Address;
  decimals: 18;
  min: string;
  max: string;
  /** Fixed presets for tokens with no creator-configured amounts (MEZO has no USD peg). null → creator's amounts. */
  presets: string[] | null;
}
export const TIP_TOKENS: Record<TipTokenSymbol, TipTokenInfo> = {
  MUSD: { symbol: "MUSD", name: "Mezo USD", address: MUSD, decimals: 18, min: TIP_LIMITS.MIN, max: TIP_LIMITS.MAX, presets: null },
  MEZO: { symbol: "MEZO", name: "MEZO", address: MEZO_TOKEN, decimals: 18, min: "0.1", max: "1000000", presets: ["10", "50", "100", "500"] },
};
export function tipTokenByAddress(a: string | null | undefined): TipTokenInfo | null {
  if (!a) return null;
  const l = a.toLowerCase();
  return Object.values(TIP_TOKENS).find((t) => t.address.toLowerCase() === l) ?? null;
}

/** Mezo Borrow (MUSD troves) on testnet. Live params read 2026-11-13: minNetDebt 1,800 MUSD, gas compensation
 *  200 MUSD, MCR 110%, CCR 150%; PriceFeed.fetchPrice ≈ $69.4k/BTC. Collateral is native BTC (msg.value). */
export const MEZO_BORROW = {
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5" as Address,
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0" as Address,
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA" as Address,
  hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6" as Address,
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366" as Address,
  MIN_NET_DEBT: "1800",
  GAS_COMPENSATION: "200",
  MCR_PERCENT: 110,
  /** What the UI aims for when opening a loan (well above MCR). */
  SAFE_RATIO_PERCENT: 200,
} as const;

/** Mezo pools (Velodrome-style router; token→token, BTC via its ERC-20 precompile + approve). Quotes verified:
 *  0.0001 BTC → ~7.83 MUSD on the MUSD/BTC volatile pool. */
export const MEZO_POOLS = {
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9" as Address,
  factory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A" as Address,
  musdBtcPool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9" as Address,
  DEFAULT_SLIPPAGE_BPS: 100,
} as const;

/** How a supporter got the funds for a tip (recorded with the tip; verified on chain when a tx hash is given). */
export type FundingKind = "swap_btc" | "loan_draw" | "loan_open";
export const TESTNET_DAPP_URL = "https://testnet.mezo.org";
