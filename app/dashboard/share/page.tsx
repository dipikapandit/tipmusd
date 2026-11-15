import type { Metadata } from "next";
import { SharePanel } from "@/components/dashboard/share-panel";

export const metadata: Metadata = { title: "Share" };

export default function SharePage() {
  return <SharePanel />;
}
