import type { Metadata } from "next";
import { Activity } from "@/components/dashboard/activity";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return <Activity />;
}
