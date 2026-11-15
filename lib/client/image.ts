/**
 * Client-side avatar prep: center-crop to a square, resize to 512px, encode as webp (jpeg fallback) and step the
 * quality down until it fits the server limit (200 KB decoded). Browser only.
 */
export const AVATAR_SIZE = 512;
export const AVATAR_MAX_BYTES = 200 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"];

export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // revoke after decode; the decoded bitmap stays usable for drawImage
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Square crop region (x, y, size) for zoom ≥ 1 and an offset in -1..1 on each axis. */
export function cropRect(w: number, h: number, zoom = 1, ox = 0, oy = 0) {
  const side = Math.min(w, h) / Math.max(1, zoom);
  const cx = w / 2 + (ox * (w - side)) / 2;
  const cy = h / 2 + (oy * (h - side)) / 2;
  return { x: Math.max(0, Math.min(w - side, cx - side / 2)), y: Math.max(0, Math.min(h - side, cy - side / 2)), size: side };
}

export async function prepareAvatar(file: File, opts: { zoom?: number; ox?: number; oy?: number } = {}): Promise<string> {
  if (file.type && !ACCEPTED.includes(file.type)) throw new Error("Use a PNG, JPEG or WebP image.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is too large. Pick one under 15 MB.");
  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error("We couldn't read that image. Try a PNG or JPEG.");
  }
  const r = cropRect(img.naturalWidth, img.naturalHeight, opts.zoom, opts.ox, opts.oy);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, r.x, r.y, r.size, r.size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

  // JPEG first: it works everywhere (link previews, canvas, old Safari). WebP only if JPEG can't fit.
  for (const type of ["image/jpeg", "image/webp"]) {
    for (const q of [0.86, 0.78, 0.68, 0.56, 0.45]) {
      const url = canvas.toDataURL(type, q);
      if (!url.startsWith(`data:${type}`)) break; // type unsupported (Safari < 14 for webp)
      if (dataUrlBytes(url) <= AVATAR_MAX_BYTES) return url;
    }
  }
  throw new Error("We couldn't make that image small enough. Try another one.");
}
