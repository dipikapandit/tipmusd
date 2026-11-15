import { ImageResponse } from "next/og";
import { getDb } from "@/lib/server/db";
import { getAvatar } from "@/lib/server/profiles";
import { ACCENT_HEX, PRESET_COLORS, fallbackPreset, initials } from "@/lib/client/accents";
import { SITE } from "@/lib/client/site";
import { loadCreator } from "./data";

export const alt = "Support this creator on Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function avatarDataUrl(username: string): Promise<string | null> {
  try {
    const a = await getAvatar(await getDb(), username);
    if (!a || !/^image\/(png|jpeg)$/.test(a.contentType)) return null; // satori can't draw webp
    return `data:${a.contentType};base64,${a.bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const result = await loadCreator(decodeURIComponent(username), null).catch(() => null);
  const creator = result && !("redirectTo" in result) ? result : null;

  if (!creator) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#fdfbfa", color: "#1c1513", fontSize: 64, fontWeight: 700 }}>
          TipMUSD
        </div>
      ),
      size,
    );
  }

  const accent = ACCENT_HEX[creator.accent] ?? ACCENT_HEX.orange;
  const photo = creator.avatarUrl ? await avatarDataUrl(creator.username) : null;
  const preset = PRESET_COLORS[creator.avatarPreset ?? fallbackPreset(creator.username)];
  const name = creator.displayName.length > 28 ? `${creator.displayName.slice(0, 27)}…` : creator.displayName;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fdfbfa", color: "#1c1513" }}>
        <div style={{ width: 430, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: accent.fill }}>
          {photo ? (
            <img src={photo} width={280} height={280} alt="" style={{ borderRadius: 999, border: "10px solid #fdfbfa", objectFit: "cover" }} />
          ) : (
            <div
              style={{
                width: 280,
                height: 280,
                borderRadius: 999,
                border: "10px solid #fdfbfa",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `linear-gradient(135deg, ${preset.from}, ${preset.to})`,
                color: preset.ink,
                fontSize: 108,
                fontWeight: 700,
              }}
            >
              {initials(creator.displayName)}
            </div>
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 64px" }}>
          <div style={{ fontSize: 34, color: "#635855", fontWeight: 500 }}>Support</div>
          <div style={{ fontSize: name.length > 18 ? 68 : 84, fontWeight: 700, letterSpacing: -2, lineHeight: 1.02, marginTop: 6 }}>{name}</div>
          <div style={{ fontSize: 34, color: "#635855", fontWeight: 500, marginTop: 12 }}>on Mezo</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 56, fontSize: 28, color: "#1c1513", fontWeight: 600 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#cf3d0b", marginRight: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 14, height: 14, borderRadius: 999, background: "#fdfbfa" }} />
            </div>
            {SITE.host}/{creator.username}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
