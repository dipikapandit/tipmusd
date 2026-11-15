"use client";

import { useId, useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "sonner";
import type { CreatorProfile, TipLink } from "@/lib/api-types";
import { errorMessage } from "@/lib/client/api";
import { ACCENT_HEX, fallbackPreset } from "@/lib/client/accents";
import { track } from "@/lib/client/analytics";
import { downloadDataUrl, downloadText, qrPngDataUrl, qrSvg, renderQrCard } from "@/lib/client/qr";
import { creatorShareText, embedSnippet, qrTarget } from "@/lib/client/share";
import { stripScheme } from "@/lib/client/deeplinks";
import { useAuth } from "@/hooks/use-auth";
import { useCreateTipLink, useTipLinks, useUpdateTipLink } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyButton, CopyField } from "@/components/share/copy-button";
import { QrImage } from "@/components/share/qr-image";
import { ShareRow } from "@/components/share/share-row";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function SharePanel() {
  const { profile } = useAuth();
  if (!profile) return null;
  return <Share p={profile} />;
}

function Share({ p }: { p: CreatorProfile }) {
  const qr = qrTarget(p.tipUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error("Download failed", { description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const base = `tipmusd-${p.username}`;

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Share</h1>

      <section aria-labelledby="s-link" className="mt-8">
        <h2 id="s-link" className="text-lg font-semibold">
          Your link
        </h2>
        <CopyField className="mt-3 max-w-xl" value={p.tipUrl} display={stripScheme(p.tipUrl)} onCopy={() => track(p.username, "share_click", "copy")} />
        <ShareRow className="mt-4" url={p.tipUrl} text={creatorShareText(p.displayName)} onShare={(c) => track(p.username, "share_click", c)} />
      </section>

      <section aria-labelledby="s-qr" className="mt-12 grid gap-8 border-t pt-10 md:grid-cols-[16rem_1fr]">
        <QrImage text={qr} className="w-64 border" label="QR code for your tip link" />
        <div>
          <h2 id="s-qr" className="text-lg font-semibold">
            QR code
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Scans open your tip page and are counted as QR visits in Analytics.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy !== null} onClick={() => run("png", async () => downloadDataUrl(await qrPngDataUrl(qr, 1024), `${base}-qr.png`))}>
              <Download aria-hidden /> PNG
            </Button>
            <Button variant="outline" disabled={busy !== null} onClick={() => run("svg", async () => downloadText(await qrSvg(qr), `${base}-qr.svg`))}>
              <Download aria-hidden /> SVG
            </Button>
            <Button
              disabled={busy !== null}
              onClick={() =>
                run("card", async () =>
                  downloadDataUrl(
                    await renderQrCard({
                      qrText: qr,
                      displayName: p.displayName,
                      displayUrl: stripScheme(p.tipUrl),
                      avatarUrl: p.avatarUrl,
                      preset: p.avatarPreset ?? fallbackPreset(p.username),
                      accent: ACCENT_HEX[p.accent]?.fill ?? ACCENT_HEX.orange.fill,
                    }),
                    `${base}-card.png`,
                  ),
                )
              }
            >
              <Download aria-hidden /> {busy === "card" ? "Making your card…" : "QR card"}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">The card has your photo, name and the QR, sized for printing or a story.</p>
        </div>
      </section>

      <Campaigns />

      <section aria-labelledby="s-embed" className="mt-12 border-t pt-10">
        <h2 id="s-embed" className="text-lg font-semibold">
          Button for your website
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">Paste this into any page. It&apos;s a plain link styled as a button, no scripts.</p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <a
            href={p.tipUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center rounded-full px-5 text-[15px] font-semibold text-white"
            style={{ background: ACCENT_HEX[p.accent]?.fill }}
          >
            Tip me in MUSD
          </a>
          <span className="text-sm text-muted-foreground">Preview</span>
        </div>
        <div className="relative mt-4 max-w-2xl">
          <pre className="overflow-x-auto rounded-xl bg-muted p-4 pr-14 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">
            {embedSnippet(p.tipUrl, "Tip me in MUSD", ACCENT_HEX[p.accent]?.fill)}
          </pre>
          <CopyButton value={embedSnippet(p.tipUrl, "Tip me in MUSD", ACCENT_HEX[p.accent]?.fill)} label="Copy embed code" className="absolute top-3 right-3 m-0" />
        </div>
      </section>
    </div>
  );
}

function Campaigns() {
  const q = useTipLinks();
  const create = useCreateTipLink();
  const update = useUpdateTipLink();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const id = useId();
  const effSlug = slugTouched ? slug : slugify(name);
  const slugOk = SLUG_RE.test(effSlug);

  return (
    <section aria-labelledby="s-camp" className="mt-12 border-t pt-10">
      <h2 id="s-camp" className="text-lg font-semibold">
        Campaign links
      </h2>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        Same page, separate link. Use one per stream, talk or post to see which brought in tips. The campaign name shows on your page.
      </p>

      <form
        className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !slugOk) return;
          try {
            await create.mutateAsync({ slug: effSlug, campaignName: name.trim() });
            setName("");
            setSlug("");
            setSlugTouched(false);
            toast.success("Campaign link created");
          } catch (err) {
            toast.error("Couldn't create the link", { description: errorMessage(err) });
          }
        }}
      >
        <div>
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Name
          </label>
          <Input id={`${id}-name`} className="mt-1.5" maxLength={60} placeholder="Friday stream" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${id}-slug`} className="text-sm font-medium">
            Link code
          </label>
          <Input
            id={`${id}-slug`}
            className="mt-1.5 font-mono"
            maxLength={40}
            value={effSlug}
            aria-invalid={effSlug !== "" && !slugOk}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </div>
        <Button type="submit" disabled={!name.trim() || !slugOk || create.isPending}>
          <Plus aria-hidden /> Add
        </Button>
      </form>
      {effSlug && !slugOk ? <p className="mt-2 text-sm text-bad">Use lowercase letters, numbers and dashes.</p> : null}

      <div className="mt-6 max-w-3xl">
        {q.isLoading ? (
          <Skeleton className="h-16 w-full rounded-xl" />
        ) : q.data?.length ? (
          <ul className="divide-y border-y">
            {q.data.map((l: TipLink) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className={l.isActive ? "font-medium" : "font-medium text-muted-foreground line-through"}>{l.campaignName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{stripScheme(l.url)}</p>
                </div>
                <CopyButton value={l.url} label={`Copy ${l.campaignName} link`} className="m-0" />
                <label className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
                  <Switch
                    checked={l.isActive}
                    onCheckedChange={(v) =>
                      update.mutate({ id: l.id, isActive: v }, { onError: (err) => toast.error("Couldn't update", { description: errorMessage(err) }) })
                    }
                    aria-label={`${l.campaignName} link active`}
                  />
                  {l.isActive ? "On" : "Off"}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No campaign links yet.</p>
        )}
      </div>
    </section>
  );
}
