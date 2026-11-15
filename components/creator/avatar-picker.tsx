"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { AVATAR_PRESETS, type AvatarPreset } from "@/lib/api-types";
import { PRESET_COLORS } from "@/lib/client/accents";
import { cropRect } from "@/lib/client/image";
import { cn } from "@/lib/client/utils";
import { Avatar } from "./avatar";

export interface PhotoDraft {
  file: File;
  zoom: number;
  ox: number;
  oy: number;
}

const PREVIEW = 144;

/** Pick a generated preset, or upload a photo and position it (drag + zoom). The photo is resized on save. */
export function AvatarPicker({
  name,
  preset,
  onPreset,
  photo,
  onPhoto,
  currentUrl,
  onRemoveCurrent,
}: {
  name: string;
  preset: AvatarPreset | null;
  onPreset: (p: AvatarPreset) => void;
  photo: PhotoDraft | null;
  onPhoto: (p: PhotoDraft | null) => void;
  currentUrl?: string | null;
  onRemoveCurrent?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo.file);
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setSrc(url);
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => alive && setError("We couldn't read that image. Try a PNG or JPEG.");
    img.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [photo?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  const showPhoto = Boolean(photo && src && dims);
  const r = photo && dims ? cropRect(dims.w, dims.h, photo.zoom, photo.ox, photo.oy) : null;
  const scale = r ? PREVIEW / r.size : 1;

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      <div className="flex flex-col items-center gap-2">
        {showPhoto && photo && r && dims ? (
          <div
            className="relative touch-none overflow-hidden rounded-full bg-muted select-none"
            style={{ width: PREVIEW, height: PREVIEW, cursor: "grab" }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, ox: photo.ox, oy: photo.oy };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const maxX = ((dims.w - r.size) / 2) * scale || 1;
              const maxY = ((dims.h - r.size) / 2) * scale || 1;
              const clamp = (v: number) => Math.max(-1, Math.min(1, v));
              onPhoto({ ...photo, ox: clamp(d.ox - (e.clientX - d.x) / maxX), oy: clamp(d.oy - (e.clientY - d.y) / maxY) });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            aria-label="Photo preview. Drag to reposition."
            role="img"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src!}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ width: dims.w * scale, height: dims.h * scale, left: -r.x * scale, top: -r.y * scale }}
            />
          </div>
        ) : (
          <Avatar name={name || "You"} url={currentUrl} preset={preset} className="size-36 text-5xl" />
        )}
        {showPhoto && photo ? (
          <label className="flex w-36 flex-col gap-1 text-xs text-muted-foreground">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={photo.zoom}
              onChange={(e) => onPhoto({ ...photo, zoom: Number(e.target.value) })}
              className="h-11 accent-[var(--brand)]"
            />
          </label>
        ) : null}
      </div>

      <div className="flex-1 space-y-4">
        <div>
          <p className="text-sm font-medium">Photo</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm font-medium hover:bg-muted"
            >
              <ImagePlus className="size-4" aria-hidden /> {photo || currentUrl ? "Choose another photo" : "Upload a photo"}
            </button>
            {photo ? (
              <button type="button" onClick={() => onPhoto(null)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground">
                <X className="size-4" aria-hidden /> Don&apos;t use this photo
              </button>
            ) : currentUrl && onRemoveCurrent ? (
              <button type="button" onClick={onRemoveCurrent} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground hover:text-foreground">
                <X className="size-4" aria-hidden /> Remove photo
              </button>
            ) : null}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
                setError("Use a PNG, JPEG or WebP image.");
                return;
              }
              setError(null);
              setSrc(null);
              setDims(null);
              onPhoto({ file: f, zoom: 1, ox: 0, oy: 0 });
            }}
          />
          {error ? (
            <p role="alert" className="mt-2 text-sm text-bad">
              {error}
            </p>
          ) : photo ? (
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">Drag the photo to position it. We shrink it to 512px before uploading.</p>
          ) : null}
        </div>
        <div>
          <p className="text-sm font-medium" id="preset-label">
            {photo || currentUrl ? "Or use a generated avatar" : "Or pick a generated avatar"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="preset-label">
            {AVATAR_PRESETS.map((p) => {
              const c = PRESET_COLORS[p];
              const on = !photo && preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={c.label}
                  onClick={() => {
                    onPhoto(null);
                    onPreset(p);
                  }}
                  className={cn("size-11 rounded-full ring-offset-2 ring-offset-background transition-shadow", on ? "ring-2 ring-foreground" : "hover:ring-2 hover:ring-border")}
                  style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
