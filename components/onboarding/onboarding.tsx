"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";
import type { AvatarPreset, CreatorProfile } from "@/lib/api-types";
import { TIP_LIMITS } from "@/lib/chain/config";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { cleanSuggested, checkTipAmount } from "@/lib/client/amount";
import { fallbackPreset } from "@/lib/client/accents";
import { prepareAvatar } from "@/lib/client/image";
import { downloadDataUrl, qrPngDataUrl } from "@/lib/client/qr";
import { creatorShareText, qrTarget } from "@/lib/client/share";
import { stripScheme } from "@/lib/client/deeplinks";
import { useAuth } from "@/hooks/use-auth";
import { useCreateProfile, useUploadAvatar } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { SignInSteps } from "@/components/wallet/auth-gate";
import { UsernameField, useUsernameAvailability } from "@/components/creator/username-field";
import { AvatarPicker, type PhotoDraft } from "@/components/creator/avatar-picker";
import { AmountsEditor } from "@/components/creator/amounts-editor";
import { CopyField } from "@/components/share/copy-button";
import { QrImage } from "@/components/share/qr-image";
import { ShareRow } from "@/components/share/share-row";

type Step = "wallet" | "username" | "about" | "amounts" | "done";
const ORDER: Step[] = ["wallet", "username", "about", "amounts", "done"];
const BIO_MAX = 280;
const NAME_MAX = 50;

export function Onboarding() {
  const mounted = useMounted();
  const router = useRouter();
  const auth = useAuth();
  const [chosen, setStep] = useState<Step>("username");
  const [created, setCreated] = useState<CreatorProfile | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [preset, setPreset] = useState<AvatarPreset | null>(null);
  const [photo, setPhoto] = useState<PhotoDraft | null>(null);
  const [amounts, setAmounts] = useState<string[]>([...TIP_LIMITS.DEFAULT_SUGGESTED]);
  const [defaultAmount, setDefaultAmount] = useState<string>(TIP_LIMITS.DEFAULT_AMOUNT);

  const avail = useUsernameAvailability(username);
  const createProfile = useCreateProfile();
  const uploadAvatar = useUploadAvatar();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Not signed in → wallet step. Already onboarded → dashboard (unless we just created the page here).
  const step: Step = created ? "done" : !auth.signedIn ? "wallet" : chosen;
  useEffect(() => {
    if (!mounted || auth.sessionLoading || created) return;
    if (auth.signedIn && auth.profile) router.replace("/dashboard");
  }, [mounted, auth.sessionLoading, auth.signedIn, auth.profile, created, router]);

  const go = (s: Step) => {
    setStep(s);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const finish = async () => {
    setSaveError(null);
    const suggested = cleanSuggested(amounts);
    if (!suggested.length) {
      setSaveError("Add at least one amount.");
      return;
    }
    const def = checkTipAmount(defaultAmount);
    const defaultValue = def.ok && suggested.includes(def.normalized) ? def.normalized : suggested[Math.min(1, suggested.length - 1)];
    setSaving(true);
    try {
      const profile = await createProfile.mutateAsync({
        username: avail.username,
        displayName: displayName.trim(),
        bio: bio.trim() || undefined,
        avatarPreset: preset ?? fallbackPreset(avail.username),
        suggestedAmounts: suggested,
        defaultAmount: defaultValue,
      });
      let final = profile;
      if (photo) {
        try {
          const dataUrl = await prepareAvatar(photo.file, photo);
          final = await uploadAvatar.mutateAsync(dataUrl);
        } catch (e) {
          toast.error("Your page is live, but the photo didn't upload", { description: `${errorMessage(e)} You can add it in Settings.` });
        }
      }
      setCreated(final);
      go("done");
    } catch (e) {
      if (e instanceof ApiClientError && (e.code === "username_taken" || e.status === 409)) {
        setSaveError("Someone just took that username. Pick another one.");
        go("username");
      } else setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  if (!mounted || auth.sessionLoading) {
    return (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    );
  }

  const index = ORDER.indexOf(step);
  const nameOk = displayName.trim().length > 0;

  return (
    <div>
      {step !== "done" ? (
        <div className="mb-8">
          <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
            Step {index + 1} of 4
          </p>
          <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden>
            {ORDER.slice(0, 4).map((s, i) => (
              <span key={s} className={`h-1 rounded-full ${i <= index ? "bg-brand" : "bg-border"}`} />
            ))}
          </div>
        </div>
      ) : null}

      <AnimatePresence mode="wait" initial={false}>
        <Pane key={step}>
          {step === "wallet" ? (
            <>
              <Title>Start with your wallet</Title>
              <Lead>Tips go straight to this wallet. Signing in is free and sends nothing.</Lead>
              <div className="mt-8">
                <SignInSteps onSignedIn={() => undefined} />
              </div>
            </>
          ) : step === "username" ? (
            <>
              <Title>Pick your link</Title>
              <Lead>This is what you&apos;ll share. You can change it later, once every 30 days.</Lead>
              <form
                className="mt-8"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (avail.state === "available" || avail.state === "error") go("about");
                }}
              >
                <UsernameField value={username} onChange={setUsername} autoFocus />
                {saveError ? (
                  <p role="alert" className="mt-3 text-sm text-bad">
                    {saveError}
                  </p>
                ) : null}
                <Button type="submit" size="lg" className="mt-8 w-full sm:w-auto" disabled={!(avail.state === "available" || avail.state === "error")}>
                  Continue
                </Button>
              </form>
            </>
          ) : step === "about" ? (
            <>
              <Back onClick={() => go("username")} />
              <Title>Tell supporters who you are</Title>
              <Lead>Shown at the top of your tip page.</Lead>
              <form
                className="mt-8 space-y-6"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameOk) go("amounts");
                }}
              >
                <div>
                  <label htmlFor="display-name" className="text-sm font-medium">
                    Display name
                  </label>
                  <Input
                    id="display-name"
                    className="mt-1.5"
                    value={displayName}
                    maxLength={NAME_MAX}
                    autoComplete="name"
                    onChange={(e) => setDisplayName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div>
                  <label htmlFor="bio" className="text-sm font-medium">
                    Bio <span className="font-normal text-muted-foreground">(optional)</span>
                  </label>
                  <Textarea id="bio" className="mt-1.5" value={bio} maxLength={BIO_MAX} onChange={(e) => setBio(e.target.value)} placeholder="What you make, in a sentence or two." />
                  <p className="num mt-1 text-right text-xs text-muted-foreground">
                    {bio.length}/{BIO_MAX}
                  </p>
                </div>
                <AvatarPicker name={displayName} preset={preset ?? fallbackPreset(avail.username || "x")} onPreset={setPreset} photo={photo} onPhoto={setPhoto} />
                <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={!nameOk}>
                  Continue
                </Button>
              </form>
            </>
          ) : step === "amounts" ? (
            <>
              <Back onClick={() => go("about")} />
              <Title>Suggested amounts</Title>
              <Lead>Supporters tap one of these, or type their own. In MUSD. MEZO tips use set amounts.</Lead>
              <div className="mt-8">
                <AmountsEditor amounts={amounts} onAmounts={setAmounts} defaultAmount={defaultAmount} onDefault={setDefaultAmount} />
              </div>
              {saveError ? (
                <p role="alert" className="mt-4 rounded-xl bg-bad-soft p-3.5 text-sm">
                  {saveError}
                </p>
              ) : null}
              <Button size="lg" variant="brand" className="mt-8 w-full sm:w-auto" disabled={saving} onClick={finish}>
                {saving ? "Creating your page…" : "Create my tip page"}
              </Button>
            </>
          ) : created ? (
            <Done profile={created} />
          ) : null}
        </Pane>
      </AnimatePresence>
    </div>
  );
}

function Pane({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
      transition={{ duration: reduce ? 0.1 : 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => <h1 className="font-display text-[2rem] leading-[1.08] font-bold tracking-[-0.03em] sm:text-4xl">{children}</h1>;
const Lead = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-muted-foreground">{children}</p>;
const Back = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground hover:text-foreground">
    <ArrowLeft className="size-4" aria-hidden /> Back
  </button>
);

function Done({ profile }: { profile: CreatorProfile }) {
  const qr = qrTarget(profile.tipUrl);
  return (
    <div>
      <h1 className="font-display text-[2.25rem] leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">You&apos;re live.</h1>
      <p className="mt-3 text-lg text-muted-foreground">Share your link and tips will land in your wallet.</p>
      <CopyField className="mt-8" value={profile.tipUrl} display={stripScheme(profile.tipUrl)} />
      <div className="mt-8 grid items-start gap-6 sm:grid-cols-[11rem_1fr]">
        <div>
          <QrImage text={qr} className="w-44 border" label={`QR code for your tip link`} />
          <button
            type="button"
            onClick={async () => downloadDataUrl(await qrPngDataUrl(qr), `tipmusd-${profile.username}-qr.png`)}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <Download className="size-4" aria-hidden /> Download QR
          </button>
        </div>
        <div>
          <p className="text-sm font-medium">Share it</p>
          <ShareRow className="mt-2" url={profile.tipUrl} text={creatorShareText(profile.displayName)} />
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
          Go to your dashboard
        </Link>
        <Link href={`/${profile.username}`} className={buttonVariants({ size: "lg", variant: "outline" })}>
          View your page
        </Link>
      </div>
    </div>
  );
}
