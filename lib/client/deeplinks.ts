/**
 * Opening the current page inside a mobile wallet's built-in browser. Used when no wallet is found,
 * typically inside the X / LinkedIn in-app browser on a phone.
 */
export interface WalletDeepLink {
  id: string;
  name: string;
  href: string;
}

/** `https://tipmusd.app/ada?amount=5` → host+path+query without the scheme. */
export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

export function walletDeepLinks(currentUrl: string): WalletDeepLink[] {
  const bare = stripScheme(currentUrl);
  const enc = encodeURIComponent(currentUrl);
  return [
    { id: "metamask", name: "MetaMask", href: `https://metamask.app.link/dapp/${bare}` },
    { id: "coinbase", name: "Coinbase Wallet", href: `https://go.cb-w.com/dapp?cb_url=${enc}` },
    { id: "trust", name: "Trust Wallet", href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}` },
    { id: "okx", name: "OKX Wallet", href: `okx://wallet/dapp/url?dappUrl=${enc}` },
  ];
}

export function isMobileUA(ua: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

/** In-app browsers of social apps (where extensions never exist). */
export function isInAppBrowser(ua: string): boolean {
  return /(Twitter|FBAN|FBAV|Instagram|LinkedInApp|Line\/|TikTok|Snapchat|; wv\))/i.test(ua);
}
