"use client";

import { useEffect, useState } from "react";
import { qrSvg } from "@/lib/client/qr";
import { cn } from "@/lib/client/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Client-rendered QR as inline SVG, always dark-on-light so phones can scan it in either theme. */
export function QrImage({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [svg, setSvg] = useState<{ text: string; svg: string } | null>(null);
  useEffect(() => {
    let alive = true;
    qrSvg(text)
      .then((s) => alive && setSvg({ text, svg: s }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [text]);
  return (
    <div className={cn("aspect-square rounded-2xl bg-white p-3", className)}>
      {svg && svg.text === text ? (
        <div role="img" aria-label={label ?? `QR code for ${text}`} className="size-full [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg.svg }} />
      ) : (
        <Skeleton className="size-full rounded-xl" />
      )}
    </div>
  );
}
