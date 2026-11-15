"use client";

import Link from "next/link";
import { useMe } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";
import { buttonVariants } from "@/components/ui/button";

/** "Dashboard" for a signed-in creator, otherwise the main call to action. */
export function HeaderAccount() {
  const mounted = useMounted();
  const me = useMe();
  const signedIn = mounted && Boolean(me.data?.user);
  const onboarded = signedIn && Boolean(me.data?.profile);
  return (
    <Link href={onboarded ? "/dashboard" : "/start"} className={buttonVariants({ size: "default" })}>
      {onboarded ? "Dashboard" : signedIn ? "Finish setup" : "Create your link"}
    </Link>
  );
}
