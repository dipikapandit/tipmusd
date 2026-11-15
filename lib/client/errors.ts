import { decodeErrorResult, parseAbi, type Hex } from "viem";
import { ApiClientError } from "./api";

/**
 * Turns wallet, RPC and API errors into one plain sentence a person can act on.
 * Raw hex never reaches the screen.
 */
export type TxErrorKind = "rejected" | "network" | "revert" | "funds_btc" | "funds_musd" | "rpc" | "api" | "unknown";
export interface TxError {
  kind: TxErrorKind;
  title: string;
  message: string;
  errorName?: string;
}

const OZ_ERRORS = parseAbi([
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InvalidSender(address sender)",
]);

export const ERROR_MESSAGES: Record<string, string> = {
  ERC20InsufficientBalance: "Your wallet doesn't have enough MUSD for this tip.",
  ERC20InvalidReceiver: "This creator's wallet can't receive MUSD. Nothing was sent.",
  ERC20InvalidSender: "This wallet can't send MUSD. Nothing was sent.",
};

/** "TransferExpired" → "Transfer expired." */
export function humanizeErrorName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (!words.length) return "The transaction was rejected.";
  return `${words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ")}.`;
}

export function decodeRevertData(data: Hex): { errorName: string } | null {
  try {
    const r = decodeErrorResult({ abi: OZ_ERRORS, data });
    return { errorName: r.errorName };
  } catch {
    return null;
  }
}

type Loose = {
  name?: string;
  code?: number | string;
  message?: string;
  shortMessage?: string;
  details?: string;
  reason?: string;
  data?: unknown;
  raw?: unknown;
  cause?: unknown;
};

function links(err: unknown): Loose[] {
  const out: Loose[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur) && out.length < 12) {
    seen.add(cur);
    out.push(cur as Loose);
    cur = (cur as Loose).cause;
  }
  return out;
}

const text = (e: Loose) => [e.shortMessage, e.details, e.message, e.reason].filter((s): s is string => typeof s === "string").join("\n");

function revert(name: string): TxError {
  if (name === "ERC20InsufficientBalance") return { kind: "funds_musd", title: "Not enough MUSD", message: ERROR_MESSAGES[name], errorName: name };
  return { kind: "revert", title: "Transaction rejected", message: ERROR_MESSAGES[name] ?? humanizeErrorName(name), errorName: name };
}

export const BTC_FEE_HELP = "Network fees on Mezo are paid in BTC. Add a little testnet BTC from the faucet, then try again.";

export function isUserRejection(err: unknown): boolean {
  return describeTxError(err).kind === "rejected";
}

export function describeTxError(err: unknown): TxError {
  if (err == null) return { kind: "unknown", title: "Something went wrong", message: "Please try again." };
  if (typeof err === "string") return { kind: "unknown", title: "Something went wrong", message: err };
  if (err instanceof ApiClientError) {
    return { kind: "api", title: err.status === 0 ? "Can't reach TipMUSD" : "That didn't work", message: err.message };
  }
  const chain = links(err);

  for (const e of chain) {
    if (e.name === "ChainMismatchError" || e.name === "ChainNotConfiguredError") {
      return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
    }
    if (
      e.name === "UserRejectedRequestError" ||
      e.code === 4001 ||
      e.code === "ACTION_REJECTED" ||
      /user (rejected|denied)|rejected the request|request rejected|denied (transaction|message) signature|user cancelled|user canceled/i.test(text(e))
    ) {
      return { kind: "rejected", title: "Cancelled in your wallet", message: "You cancelled the request. Nothing was sent." };
    }
  }

  for (const e of chain) {
    const d = e.data as { errorName?: string; args?: readonly unknown[] } | undefined;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      if (d.errorName === "Error" && typeof d.args?.[0] === "string") return { kind: "revert", title: "Transaction rejected", message: d.args[0] };
      return revert(d.errorName);
    }
    for (const candidate of [e.raw, e.data]) {
      if (typeof candidate === "string" && /^0x[0-9a-fA-F]{8}/.test(candidate)) {
        const dec = decodeRevertData(candidate as Hex);
        if (dec) return revert(dec.errorName);
      }
    }
  }

  const all = chain.map(text).join("\n");
  if (/transfer amount exceeds balance|insufficient balance for transfer|ERC20InsufficientBalance/i.test(all)) {
    return revert("ERC20InsufficientBalance");
  }
  if (/insufficient funds|exceeds the balance of the account|gas required exceeds|exceeds balance/i.test(all)) {
    return { kind: "funds_btc", title: "Not enough BTC for the network fee", message: BTC_FEE_HELP };
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(all)) {
    return { kind: "rpc", title: "Another transaction is pending", message: "Wait for the pending transaction in your wallet, then try again." };
  }
  if (/timeout|timed out|took too long/i.test(all)) {
    return { kind: "rpc", title: "Mezo is slow right now", message: "We didn't hear back in time. Check the explorer before trying again." };
  }
  if (/fetch failed|failed to fetch|network error|HTTP request failed/i.test(all)) {
    return { kind: "rpc", title: "Can't reach Mezo Testnet", message: "Check your connection and try again." };
  }
  if (/chain mismatch|does not match the target chain/i.test(all)) {
    return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
  }
  if (/not connected/i.test(all)) return { kind: "unknown", title: "Wallet not connected", message: "Connect your wallet and try again." };
  if (/method not (found|supported)|does not support|unsupported|not implemented/i.test(all)) {
    return { kind: "unknown", title: "Not supported by this wallet", message: "Your wallet doesn't support this request." };
  }
  if (/reverted/i.test(all)) return { kind: "revert", title: "Transaction rejected", message: "The transaction was reverted. Nothing was sent." };
  const first = chain[0];
  const msg = first?.shortMessage || first?.message;
  return { kind: "unknown", title: "Something went wrong", message: msg && msg.length < 160 ? msg : "Please try again." };
}
