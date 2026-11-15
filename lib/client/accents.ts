import type { Accent, AvatarPreset } from "@/lib/api-types";

/** sRGB versions of the CSS accent tokens, for places CSS variables can't reach (OG images, canvas, embeds). */
export const ACCENT_HEX: Record<Accent, { fill: string; soft: string; label: string }> = {
  orange: { fill: "#b94e00", soft: "#fdf0e6", label: "Orange" },
  red: { fill: "#cc272e", soft: "#fdecec", label: "Red" },
  blue: { fill: "#2068cb", soft: "#ebf2fd", label: "Blue" },
  green: { fill: "#007e46", soft: "#e6f6ed", label: "Green" },
  violet: { fill: "#7447c8", soft: "#f2edfc", label: "Violet" },
  ink: { fill: "#26201e", soft: "#f2efee", label: "Ink" },
};

export const accentOf = (a: string | null | undefined): Accent => (a && a in ACCENT_HEX ? (a as Accent) : "orange");

/** Generated avatar presets: two-stop gradients. Used when a creator hasn't uploaded a photo. */
export const PRESET_COLORS: Record<AvatarPreset, { from: string; to: string; ink: string; label: string }> = {
  sunset: { from: "#ff8a4c", to: "#d6336c", ink: "#ffffff", label: "Sunset" },
  ocean: { from: "#38bdf8", to: "#1d4ed8", ink: "#ffffff", label: "Ocean" },
  forest: { from: "#86c06c", to: "#166534", ink: "#ffffff", label: "Forest" },
  dusk: { from: "#a78bfa", to: "#3b2a6b", ink: "#ffffff", label: "Dusk" },
  sand: { from: "#f6d6a8", to: "#c98a4b", ink: "#3b2414", label: "Sand" },
  slate: { from: "#94a3b8", to: "#334155", ink: "#ffffff", label: "Slate" },
};

/** "Ada Lovelace" → "AL"; "prajal" → "P". */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const letters = parts.length === 1 ? [...parts[0]].slice(0, 1) : [[...parts[0]][0], [...parts[parts.length - 1]][0]];
  return letters.join("").toUpperCase();
}

/** Stable preset for a username when the creator picked none. */
export function fallbackPreset(seed: string): AvatarPreset {
  const keys = Object.keys(PRESET_COLORS) as AvatarPreset[];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return keys[h % keys.length];
}
