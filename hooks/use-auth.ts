"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import type { Hex } from "viem";
import type { MeResponse, NonceResponse, VerifyRequest } from "@/lib/api-types";
import { api, qs } from "@/lib/client/api";
import { useWallet } from "./use-wallet";
import { qk, useMe } from "./use-api";

/**
 * Sign in with Ethereum: GET /api/auth/nonce → personal_sign → POST /api/auth/verify.
 * `signedIn` is true only when the session wallet is the connected wallet.
 */
export function useAuth() {
  const w = useWallet();
  const me = useMe();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  const session = me.data ?? null;
  const sessionAddress = session?.user.address ?? null;
  const signedIn = Boolean(w.address && sessionAddress && sessionAddress.toLowerCase() === w.address.toLowerCase());

  const signIn = useMutation({
    mutationFn: async () => {
      if (!w.address) throw new Error("Connect a wallet first.");
      const address = w.address;
      const { message } = await api<NonceResponse>(`/api/auth/nonce${qs({ address })}`);
      const signature = (await signMessageAsync({ message })) as Hex;
      return api<MeResponse>("/api/auth/verify", { method: "POST", json: { address, message, signature } satisfies VerifyRequest });
    },
    onSuccess: async (res) => {
      qc.setQueryData<MeResponse | null>(qk.me, res);
      if (res.profile) qc.setQueryData(qk.profile, res.profile);
      await qc.invalidateQueries({ queryKey: ["api"], predicate: (q) => q.queryKey[1] !== "me" });
    },
  });

  const signOut = useMutation({
    mutationFn: () => api<{ ok: true }>("/api/auth/logout", { method: "POST", json: {} }),
    onSettled: () => {
      qc.setQueryData<MeResponse | null>(qk.me, null);
      qc.removeQueries({ queryKey: ["api"], predicate: (q) => !["me", "tip", "username"].includes(String(q.queryKey[1])) });
    },
  });

  return {
    wallet: w,
    session,
    profile: session?.profile ?? null,
    sessionAddress,
    sessionLoading: me.isLoading,
    sessionError: me.isError && !me.data,
    signedIn,
    mismatch: Boolean(w.address && sessionAddress && !signedIn),
    signIn,
    signOut,
  };
}
