import type { TipStatus } from "@/lib/api-types";

/** Plain words for every tip state and failure reason. Shared by the tip page, receipt and dashboard. */
export const STATUS_LABEL: Record<TipStatus, string> = {
  created: "Not sent",
  awaiting_wallet: "Waiting for wallet",
  submitted: "Sent, confirming",
  pending_confirmation: "Confirming",
  confirmed: "Confirmed",
  failed: "Failed",
  expired: "Expired",
};

export type StatusTone = "ok" | "pending" | "bad" | "idle";

export function statusTone(s: TipStatus): StatusTone {
  if (s === "confirmed") return "ok";
  if (s === "failed") return "bad";
  if (s === "expired" || s === "created") return "idle";
  return "pending";
}

export function failureCopy(reason: string | null | undefined): { title: string; body: string } {
  switch (reason) {
    case "reverted":
      return { title: "The transaction failed on Mezo", body: "It was rejected on chain, so no MUSD moved. You can try again." };
    case "amount_mismatch":
      return {
        title: "The amount didn't match",
        body: "The transaction sent a different amount than this tip, so it wasn't counted as this tip. Check the explorer to see what moved.",
      };
    case "user_rejected":
      return { title: "Cancelled in your wallet", body: "Nothing was sent. You can try again whenever you're ready." };
    case "wallet_error":
      return { title: "Your wallet couldn't send it", body: "Nothing was sent. Try again, or try another wallet." };
    case "timeout":
      return {
        title: "We couldn't confirm it in time",
        body: "We didn't see this transaction confirm within 30 minutes. Check the explorer. If it did go through, it will still show up for the creator.",
      };
    case "recipient_mismatch":
    case "calldata_mismatch":
    case "wrong_token":
    case "no_matching_transfer":
      return { title: "This transaction isn't this tip", body: "It didn't send MUSD to this creator as expected, so it wasn't counted." };
    case "expired":
      return { title: "This tip expired", body: "It wasn't sent within 30 minutes. Start a new one." };
    default:
      return { title: "This tip didn't go through", body: "Nothing was counted. You can try again." };
  }
}
