"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSignMessage } from "wagmi";
import { getAddress, type Hex } from "viem";
import { AlertTriangle, ArrowRight, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ACCENTS, type CreatorProfile, type NonceResponse, type SocialLink, type UpdateProfileRequest } from "@/lib/api-types";
import { explorerAddress } from "@/lib/chain/config";
import { api, errorMessage } from "@/lib/client/api";
import { ACCENT_HEX, fallbackPreset } from "@/lib/client/accents";
import { checkTipAmount, cleanSuggested } from "@/lib/client/amount";
import { describeTxError } from "@/lib/client/errors";
import { formatDate, nowMs, shortAddress } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { qk, useRemoveAvatar, useUpdateProfile, useUploadAvatar } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { prepareAvatar } from "@/lib/client/image";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AmountsEditor } from "@/components/creator/amounts-editor";
import { AvatarPicker, type PhotoDraft } from "@/components/creator/avatar-picker";
import { ProfilePreview } from "@/components/creator/profile-preview";
import { SocialEditor } from "@/components/creator/social-editor";
import { UsernameField, useUsernameAvailability } from "@/components/creator/username-field";
import { ConnectDialog } from "@/components/wallet/connect-dialog";

const COOLDOWN_DAYS = 30;

export function Settings() {
  const { profile } = useAuth();
  if (!profile) return null;
  // Re-mount the form when the saved profile changes underneath (e.g. after an avatar upload elsewhere).
  return <SettingsForm key={profile.updatedAt} p={profile} />;
}

type Draft = Required<Omit<UpdateProfileRequest, "username" | "avatarPreset">> & { avatarPreset: CreatorProfile["avatarPreset"] };

function draftOf(p: CreatorProfile): Draft {
  return {
    displayName: p.displayName,
    bio: p.bio,
    avatarPreset: p.avatarPreset,
    socialLinks: p.socialLinks,
    suggestedAmounts: p.suggestedAmounts,
    defaultAmount: p.defaultAmount,
    thankYouMessage: p.thankYouMessage,
    accent: p.accent,
    publicActivityEnabled: p.publicActivityEnabled,
    anonymousTipsEnabled: p.anonymousTipsEnabled,
    messagesEnabled: p.messagesEnabled,
    acceptMezo: p.acceptMezo,
  };
}

const sameLinks = (a: SocialLink[], b: SocialLink[]) => JSON.stringify(a) === JSON.stringify(b);

function SettingsForm({ p }: { p: CreatorProfile }) {
  const [d, setD] = useState<Draft>(() => draftOf(p));
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const update = useUpdateProfile();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const ids = { name: useId(), bio: useId(), thanks: useId() };
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const changes = useMemo(() => {
    const out: UpdateProfileRequest = {};
    const base = draftOf(p);
    (Object.keys(base) as (keyof Draft)[]).forEach((k) => {
      const a = d[k];
      const b = base[k];
      const same = Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a === b;
      if (!same) (out as Record<string, unknown>)[k] = a;
    });
    if (out.socialLinks && sameLinks(out.socialLinks, p.socialLinks)) delete out.socialLinks;
    return out;
  }, [d, p]);
  const dirty = Object.keys(changes).length > 0 || photo !== null;

  const save = async () => {
    const body: UpdateProfileRequest = { ...changes };
    if (body.displayName !== undefined && !body.displayName.trim()) return toast.error("Add a display name.");
    if (body.socialLinks) {
      const links = body.socialLinks.filter((l) => l.url.trim());
      if (links.some((l) => !/^https:\/\/\S+\.\S+/i.test(l.url))) return toast.error("Social links need a full https:// address.");
      body.socialLinks = links;
    }
    if (body.suggestedAmounts || body.defaultAmount) {
      const amounts = cleanSuggested(d.suggestedAmounts);
      if (!amounts.length) return toast.error("Add at least one suggested amount.");
      const def = checkTipAmount(d.defaultAmount);
      body.suggestedAmounts = amounts;
      body.defaultAmount = def.ok && amounts.includes(def.normalized) ? def.normalized : amounts[0];
    }
    try {
      if (photo) {
        const dataUrl = await prepareAvatar(photo.file, photo);
        await upload.mutateAsync(dataUrl);
      }
      if (Object.keys(body).length) await update.mutateAsync(body);
      setPhoto(null);
      toast.success("Saved. Your page is updated.");
    } catch (e) {
      toast.error("Couldn't save", { description: errorMessage(e) });
    }
  };

  const busy = update.isPending || upload.isPending;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Settings</h1>
        <Link href="/dashboard/developers" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground lg:hidden">
          Developers <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-12">
          <Section title="Profile">
            <div>
              <label htmlFor={ids.name} className="text-sm font-medium">
                Display name
              </label>
              <Input id={ids.name} className="mt-1.5" maxLength={50} value={d.displayName} onChange={(e) => set("displayName", e.target.value)} />
            </div>
            <div>
              <label htmlFor={ids.bio} className="text-sm font-medium">
                Bio
              </label>
              <Textarea id={ids.bio} className="mt-1.5" maxLength={280} value={d.bio} onChange={(e) => set("bio", e.target.value)} />
              <p className="num mt-1 text-right text-xs text-muted-foreground">{d.bio.length}/280</p>
            </div>
            <AvatarPicker
              name={d.displayName}
              preset={d.avatarPreset ?? fallbackPreset(p.username)}
              onPreset={(v) => set("avatarPreset", v)}
              photo={photo}
              onPhoto={setPhoto}
              currentUrl={p.avatarUrl}
              onRemoveCurrent={() =>
                remove.mutate(undefined, {
                  onSuccess: () => toast.success("Photo removed"),
                  onError: (e) => toast.error("Couldn't remove the photo", { description: errorMessage(e) }),
                })
              }
            />
            <div>
              <p className="text-sm font-medium">Links</p>
              <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">Up to 6. Shown under your bio.</p>
              <div className="mt-2">
                <SocialEditor links={d.socialLinks} onChange={(v) => set("socialLinks", v)} />
              </div>
            </div>
          </Section>

          <Section title="Page color">
            <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={d.accent === a}
                  onClick={() => set("accent", a)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-medium",
                    d.accent === a ? "border-foreground" : "hover:bg-muted",
                  )}
                >
                  <span className="size-4 rounded-full" style={{ background: ACCENT_HEX[a].fill }} aria-hidden />
                  {ACCENT_HEX[a].label}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Amounts">
            <AmountsEditor amounts={d.suggestedAmounts} onAmounts={(v) => set("suggestedAmounts", v)} defaultAmount={d.defaultAmount} onDefault={(v) => set("defaultAmount", v)} />
          </Section>

          <Section title="After someone tips">
            <div>
              <label htmlFor={ids.thanks} className="text-sm font-medium">
                Thank-you message
              </label>
              <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">Shown to supporters once their tip confirms.</p>
              <Textarea
                id={ids.thanks}
                className="mt-1.5"
                maxLength={280}
                value={d.thankYouMessage}
                placeholder="Thank you, this means a lot."
                onChange={(e) => set("thankYouMessage", e.target.value)}
              />
            </div>
          </Section>

          <Section title="Tokens">
            <Toggle
              label="Accept MEZO tips"
              hint="Supporters can pick MUSD or MEZO. MUSD always works. MEZO tips use set amounts (10, 50, 100, 500)."
              checked={d.acceptMezo}
              onChange={(v) => set("acceptMezo", v)}
            />
          </Section>

          <Section title="Privacy">
            <Toggle
              label="Show recent supporters on my page"
              hint="Names, amounts and messages of confirmed tips, here and on Explore. Anonymous tips never show a name or wallet."
              checked={d.publicActivityEnabled}
              onChange={(v) => set("publicActivityEnabled", v)}
            />
            <Toggle label="Let supporters leave a name and message" checked={d.messagesEnabled} onChange={(v) => set("messagesEnabled", v)} />
            <Toggle label="Allow anonymous tips" checked={d.anonymousTipsEnabled} onChange={(v) => set("anonymousTipsEnabled", v)} />
          </Section>

          <div className="sticky bottom-20 z-[var(--z-sticky)] flex items-center gap-3 rounded-full border bg-background/95 p-2 pl-5 shadow-panel backdrop-blur-md lg:bottom-6">
            <p className="flex-1 text-sm text-muted-foreground" aria-live="polite">
              {dirty ? "You have unsaved changes." : "All changes saved."}
            </p>
            {dirty ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setD(draftOf(p));
                  setPhoto(null);
                }}
              >
                Discard
              </Button>
            ) : null}
            <Button disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>

          <UsernameSection p={p} />
          <WalletSection p={p} />
          <SignOutSection />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-sm font-medium text-muted-foreground">Preview</p>
            <ProfilePreview
              displayName={d.displayName}
              username={p.username}
              bio={d.bio}
              avatarUrl={photo ? null : p.avatarUrl}
              avatarPreset={d.avatarPreset}
              socialLinks={d.socialLinks.filter((l) => /^https:\/\//i.test(l.url))}
              accent={d.accent}
              amounts={d.suggestedAmounts}
              defaultAmount={d.defaultAmount}
              messagesEnabled={d.messagesEnabled}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  const hid = useId();
  return (
    <section id={id} aria-labelledby={hid} className="scroll-mt-24 space-y-5">
      <h2 id={hid} className="font-display text-xl font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">{hint}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  );
}

// ---------------------------------------------------------------- username

function UsernameSection({ p }: { p: CreatorProfile }) {
  const [value, setValue] = useState(p.username);
  const avail = useUsernameAvailability(value, p.username);
  const update = useUpdateProfile();
  const [now] = useState(nowMs);
  const nextAt = p.usernameChangedAt ? new Date(p.usernameChangedAt).getTime() + COOLDOWN_DAYS * 86_400_000 : null;
  const locked = nextAt !== null && nextAt > now;
  const canSave = !locked && (avail.state === "available" || avail.state === "error") && avail.username !== p.username;

  return (
    <Section title="Username">
      <div className="flex gap-3 rounded-xl bg-warn-soft p-3.5 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <p>
          You can change your username once every {COOLDOWN_DAYS} days. Your old link will keep working and send people here, and nobody else can claim it.
          {locked && nextAt ? ` You can change it again on ${formatDate(nextAt)}.` : ""}
        </p>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSave) return;
          try {
            await update.mutateAsync({ username: avail.username });
            toast.success(`Your link is now ${avail.username}`);
          } catch (err) {
            toast.error("Couldn't change your username", { description: errorMessage(err) });
          }
        }}
      >
        <fieldset disabled={locked} className="disabled:opacity-60">
          <UsernameField value={value} onChange={setValue} current={p.username} />
        </fieldset>
        <Button type="submit" variant="outline" className="mt-4" disabled={!canSave || update.isPending}>
          {update.isPending ? "Changing…" : "Change username"}
        </Button>
      </form>
    </Section>
  );
}

// ---------------------------------------------------------------- payout wallet

function WalletSection({ p }: { p: CreatorProfile }) {
  const auth = useAuth();
  const w = auth.wallet;
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const current = getAddress(p.recipientWallet);
  const connected = w.address ? getAddress(w.address) : null;
  const isNew = Boolean(connected && connected !== current);

  const change = async () => {
    if (!connected) return;
    setBusy(true);
    try {
      const { message } = await api<NonceResponse>("/api/profile/wallet/nonce", { method: "POST", json: { address: connected } });
      const signature = (await signMessageAsync({ message, account: connected })) as Hex;
      const updated = await api<CreatorProfile>("/api/profile/wallet", { method: "POST", json: { address: connected, message, signature } });
      qc.setQueryData(qk.profile, updated);
      await qc.invalidateQueries({ queryKey: ["api"] });
      setConfirm(false);
      toast.success("Payout wallet changed", { description: `New tips go to ${shortAddress(connected)}.` });
    } catch (e) {
      const m = describeTxError(e);
      toast.error(m.kind === "rejected" ? "Cancelled in your wallet" : "Couldn't change the wallet", { description: m.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Payout wallet" id="wallet">
      <div>
        <p className="text-sm text-muted-foreground">Tips go to</p>
        <a
          href={explorerAddress(current)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-start gap-1.5 font-mono text-sm break-all hover:underline"
        >
          {current} <ExternalLink className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        </a>
      </div>
      <div className="rounded-2xl border p-5">
        <p className="font-medium">Switch to a different wallet</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>In your wallet app, switch to the account you want tips to go to.</li>
          <li>Come back here. We&apos;ll show that address below.</li>
          <li>Sign a free message with it to prove it&apos;s yours.</li>
        </ol>
        <div className="mt-4 text-sm" aria-live="polite">
          {!connected ? (
            <>
              <Button variant="outline" onClick={() => setOpen(true)}>
                Connect the new wallet
              </Button>
              <ConnectDialog open={open} onOpenChange={setOpen} />
            </>
          ) : !isNew ? (
            <p className="text-muted-foreground">Your wallet app is still on the current payout wallet ({shortAddress(current)}). Switch accounts in your wallet to continue.</p>
          ) : (
            <div className="space-y-3">
              <p>
                New wallet: <span className="font-mono break-all">{connected}</span>
              </p>
              <div className="flex gap-3 rounded-xl bg-warn-soft p-3.5">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                <p>
                  Future tips will go to this new address. Tips already sent stay in {shortAddress(current)}. Make sure you control this wallet and have its recovery
                  phrase.
                </p>
              </div>
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="size-5 accent-[var(--brand)]" />
                <span>I control this wallet and want tips to go there.</span>
              </label>
              <Button disabled={!confirm || busy} onClick={change}>
                {busy ? "Check your wallet…" : "Sign and switch payout wallet"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function SignOutSection() {
  const auth = useAuth();
  const router = useRouter();
  return (
    <Section title="Session">
      <p className="text-sm text-muted-foreground">Signed in as {shortAddress(auth.sessionAddress)}.</p>
      <Button variant="outline" disabled={auth.signOut.isPending} onClick={() => auth.signOut.mutate(undefined, { onSuccess: () => router.push("/") })}>
        Sign out
      </Button>
    </Section>
  );
}
