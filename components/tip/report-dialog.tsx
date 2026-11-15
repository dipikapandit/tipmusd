"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import type { ReportReason } from "@/lib/api-types";
import { api, errorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "scam", label: "Scam or fraud" },
  { value: "spam", label: "Spam" },
  { value: "offensive", label: "Offensive content" },
  { value: "other", label: "Something else" },
];

export function ReportDialog({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex min-h-11 items-center text-[0.8125rem] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Report this page
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-[1.25rem] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Report @{username}</DialogTitle>
          <DialogDescription>Tell us what&apos;s wrong. We review every report.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!reason) return;
            setBusy(true);
            try {
              await api("/api/reports", { method: "POST", json: { username, reason, ...(details.trim() ? { details: details.trim().slice(0, 1000) } : {}) } });
              toast.success("Thanks. We'll take a look.");
              setOpen(false);
              setReason(null);
              setDetails("");
            } catch (err) {
              toast.error("Couldn't send the report", { description: errorMessage(err) });
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <fieldset>
            <legend className="text-sm font-medium">Reason</legend>
            <div className="mt-2 space-y-1">
              {REASONS.map((r) => (
                <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-muted has-[:checked]:bg-muted">
                  <input type="radio" name={`${id}-reason`} value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="size-4 accent-[var(--brand)]" />
                  <span className="text-sm">{r.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <Label htmlFor={`${id}-details`}>
              Details <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id={`${id}-details`} className="mt-1.5" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </div>
          <Button type="submit" className="w-full" size="lg" disabled={!reason || busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
