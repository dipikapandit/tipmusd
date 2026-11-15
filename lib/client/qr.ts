import QRCode from "qrcode";
import type { AvatarPreset } from "@/lib/api-types";
import { PRESET_COLORS, initials } from "./accents";

const QR_OPTS = { errorCorrectionLevel: "M" as const, margin: 1 };

export async function qrSvg(text: string, dark = "#1c1513", light = "#ffffff"): Promise<string> {
  return QRCode.toString(text, { ...QR_OPTS, type: "svg", color: { dark, light } });
}

export async function qrPngDataUrl(text: string, size = 1024, dark = "#1c1513", light = "#ffffff"): Promise<string> {
  return QRCode.toDataURL(text, { ...QR_OPTS, width: size, color: { dark, light } });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadText(text: string, filename: string, type = "image/svg+xml") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  downloadDataUrl(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fontStack(kind: "display" | "ui"): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue(kind === "display" ? "--ff-display" : "--ff-ui").trim();
  return v ? `${v}, system-ui, sans-serif` : "system-ui, sans-serif";
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * Printable QR card (1080x1350 PNG): avatar, name, "Tip me in MUSD", the QR (encodes `qrText`), and the short URL.
 */
export async function renderQrCard(opts: {
  qrText: string;
  displayName: string;
  displayUrl: string;
  avatarUrl: string | null;
  preset: AvatarPreset;
  accent: string;
}): Promise<string> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Your browser can't draw the card.");
  if (document.fonts?.ready) await document.fonts.ready;
  const display = fontStack("display");
  const ui = fontStack("ui");

  ctx.fillStyle = "#fdfbfa";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = opts.accent;
  ctx.fillRect(0, 0, W, 300);

  // avatar
  const cx = W / 2;
  const cy = 300;
  const r = 110;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 10, 0, Math.PI * 2);
  ctx.fillStyle = "#fdfbfa";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const img = opts.avatarUrl ? await loadImg(opts.avatarUrl) : null;
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    const p = PRESET_COLORS[opts.preset];
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, p.from);
    g.addColorStop(1, p.to);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = p.ink;
    ctx.font = `600 84px ${display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(opts.displayName), cx, cy + 4);
  }
  ctx.restore();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#1c1513";
  ctx.font = `700 64px ${display}`;
  ctx.fillText(fitText(ctx, opts.displayName, W - 160), cx, 500);
  ctx.fillStyle = "#635855";
  ctx.font = `500 40px ${ui}`;
  ctx.fillText("Tip me in MUSD", cx, 562);

  const qr = await loadImg(await qrPngDataUrl(opts.qrText, 600));
  if (qr) ctx.drawImage(qr, cx - 300, 620, 600, 600);

  ctx.fillStyle = "#1c1513";
  ctx.font = `600 38px ${ui}`;
  ctx.fillText(fitText(ctx, opts.displayUrl, W - 160), cx, 1290);
  return c.toDataURL("image/png");
}
