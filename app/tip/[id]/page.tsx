import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { Receipt } from "@/components/tip/receipt";

export const metadata: Metadata = { title: "Tip receipt", robots: { index: false, follow: false } };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-lg flex-1 px-4 py-10 sm:py-16">
        <Receipt id={id} />
      </main>
      <SiteFooter />
    </>
  );
}
