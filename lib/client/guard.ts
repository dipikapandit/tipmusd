import { MEZO_TESTNET_ID } from "@/lib/chain/config";

export type NetworkState = { kind: "disconnected" } | { kind: "wrong-network"; chainId: number | undefined } | { kind: "ready" };

/** Never send on another chain: anything except Mezo Testnet is "wrong-network". */
export function networkState(isConnected: boolean, chainId: number | undefined): NetworkState {
  if (!isConnected) return { kind: "disconnected" };
  if (chainId !== MEZO_TESTNET_ID) return { kind: "wrong-network", chainId };
  return { kind: "ready" };
}
