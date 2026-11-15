import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import { SITE } from "@/lib/client/site";
import "./globals.css";

const ui = Geist({ subsets: ["latin"], variable: "--ff-ui", display: "swap" });
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--ff-display", display: "swap", weight: ["500", "600", "700", "800"] });
const code = Geist_Mono({ subsets: ["latin"], variable: "--ff-code", display: "swap", weight: ["400", "500"] });

const title = `${SITE.name}: ${SITE.tagline}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: title, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: ["tip link", "tips", "creator", "MUSD", "Mezo", "link in bio", "QR code", "testnet"],
  openGraph: { type: "website", siteName: SITE.name, title, description: SITE.description, url: "/" },
  twitter: { card: "summary_large_image", title, description: SITE.description },
  robots: { index: true, follow: true },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: SITE.themeLight },
    { media: "(prefers-color-scheme: dark)", color: SITE.themeDark },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${ui.variable} ${display.variable} ${code.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <a
          href="#main"
          className="sr-only rounded-full bg-primary px-4 py-2.5 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[var(--z-modal)]"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
