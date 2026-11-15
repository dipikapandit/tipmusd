import { createConfig, http, type Config, type CreateConfigParameters } from "wagmi";
import type { WalletList } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { mezoTestnet } from "@/lib/chain/config";
import { SITE } from "./site";

const transports = {
  [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 400, timeout: 20_000 }),
};

const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";
/** WalletConnect (phone wallets / QR pairing) is listed only when a WalletConnect Cloud project id is set. */
export const hasWalletConnect = Boolean(wcProjectId);

type PassportConfigModule = typeof import("@mezo-org/passport/dist/src/config");

/**
 * Wallet connection goes through Mezo Passport (built on RainbowKit):
 * - Bitcoin wallets (Unisat, OKX, Xverse): the user signs with their Bitcoin key; a Mezo smart account backed by
 *   that key holds the EVM address, holds the MUSD and sends the transfer (connector type "orangekit").
 * - Ethereum wallets connect directly (MetaMask, Rabby, any injected wallet, WalletConnect when configured).
 * Mezo Testnet is the only chain.
 */
function buildWallets(passport: PassportConfigModule): WalletList {
  const evm = wcProjectId ? [metaMaskWallet, rabbyWallet, walletConnectWallet, injectedWallet] : [metaMaskWallet, rabbyWallet, injectedWallet];
  return [
    { groupName: "Bitcoin wallets", wallets: [passport.unisatWalletMezoTestnet, passport.okxWalletMezoTestnet, passport.xverseWalletMezoTestnet] },
    { groupName: "Ethereum wallets", wallets: evm },
  ];
}

/** Server render: no connectors. `ssr: true` lets wagmi hydrate the real connection in the browser. */
function serverConfig() {
  return createConfig({ chains: [mezoTestnet], transports, connectors: [], ssr: true });
}

/**
 * Browser: Passport's config, loaded from the deep `config` module because the package root re-exports
 * Passport's UI kit (React 18 only), and its Bitcoin connectors read `window` when created.
 */
function browserConfig(): Config {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const passport = require("@mezo-org/passport/dist/src/config") as PassportConfigModule;
  return passport.getConfig({
    appName: SITE.name,
    appDescription: SITE.description,
    appUrl: SITE.url,
    mezoNetwork: "testnet",
    walletConnectProjectId: wcProjectId || "tipmusd-no-walletconnect",
    wallets: buildWallets(passport),
    chains: [mezoTestnet],
    // Passport types this as Pick<CreateConfigParameters, "transports"> but spreads it into RainbowKit's
    // getDefaultConfig, which expects the transport map itself.
    transports: transports as unknown as Pick<CreateConfigParameters, "transports">,
    ssr: true,
  });
}

export const wagmiConfig: ReturnType<typeof serverConfig> =
  typeof window === "undefined" ? serverConfig() : (browserConfig() as ReturnType<typeof serverConfig>);

export { isSmartAccountConnector } from "./smart-account";

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
