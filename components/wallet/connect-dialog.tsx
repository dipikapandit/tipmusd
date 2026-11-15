"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { isMobileUA } from "@/lib/client/deeplinks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OpenInWallet } from "./open-in-wallet";

/**
 * True when the browser has any wallet Mezo Passport can use: an Ethereum wallet (window.ethereum) or a
 * Bitcoin wallet extension (Unisat, OKX, Xverse).
 */
export function hasInjectedWallet(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.ethereum || w.unisat || w.okxwallet || w.XverseProviders || w.BitcoinProvider);
}

const noop = () => () => {};
function useIsMobile() {
  return useSyncExternalStore(noop, () => isMobileUA(navigator.userAgent), () => false);
}

/**
 * Opens Mezo Passport's connect modal: Bitcoin wallets (via a Mezo smart account) or Ethereum wallets.
 * On a phone with no wallet in this browser (e.g. the X or LinkedIn in-app browser) it first offers to open the
 * page in a wallet app, with Passport's modal (WalletConnect, Bitcoin wallets) one tap away.
 * Keeps the controlled `open` / `onOpenChange` shape: `onOpenChange(false)` fires once the flow closes,
 * connected or not; `onConnected` fires when a wallet connects during the flow.
 */
export function ConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected?: () => void;
}) {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const { isConnected } = useAccount();
  const mobile = useIsMobile();
  // On a phone with no wallet here, show the "open in a wallet app" help first; `escalated` = user picked Passport.
  const [escalated, setEscalated] = useState(false);
  const needsHelp = mobile && !hasInjectedWallet();
  const helpOpen = open && needsHelp && !escalated && Boolean(openConnectModal);
  const shown = useRef(false);
  const wasConnected = useRef(isConnected);

  // Connected while the flow was open → report it once.
  useEffect(() => {
    if (open && isConnected && !wasConnected.current) onConnected?.();
    wasConnected.current = isConnected;
  }, [open, isConnected, onConnected]);

  useEffect(() => {
    if (!open || connectModalOpen || shown.current || (needsHelp && !escalated)) return;
    if (!openConnectModal) {
      // Already connected: nothing to open.
      onOpenChange(false);
      return;
    }
    shown.current = true;
    openConnectModal();
  }, [open, connectModalOpen, openConnectModal, onOpenChange, needsHelp, escalated]);

  useEffect(() => {
    if (shown.current && !connectModalOpen) {
      shown.current = false;
      setEscalated(false);
      onOpenChange(false);
    }
  }, [connectModalOpen, onOpenChange]);

  return (
    <Dialog
      open={helpOpen}
      onOpenChange={(v) => {
        if (!v) onOpenChange(false);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-[1.25rem] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Connect a wallet</DialogTitle>
          <DialogDescription>Your wallet stays yours. We never hold your keys or your money.</DialogDescription>
        </DialogHeader>
        <OpenInWallet />
        <Button
          variant="outline"
          className="mt-1 w-full"
          onClick={() => {
            setEscalated(true);
          }}
        >
          More options: WalletConnect or a Bitcoin wallet
        </Button>
      </DialogContent>
    </Dialog>
  );
}
