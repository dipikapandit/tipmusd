import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata: Metadata = {
  title: "Create your tip link",
  description: "Connect your wallet, claim your username and get a tip link and QR code in about two minutes.",
  alternates: { canonical: "/start" },
};

export default function StartPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:py-14">
        <Onboarding />
      </main>
    </>
  );
}
