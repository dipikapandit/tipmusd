import { ImageResponse } from "next/og";

export const alt = "TipMUSD: the social tipping layer for Mezo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fdfbfa", color: "#1c1513" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 80px" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 36, fontWeight: 700 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#cf3d0b", marginRight: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 22, height: 22, borderRadius: 999, background: "#fdfbfa" }} />
            </div>
            TipMUSD
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02, marginTop: 48 }}>Your work deserves support.</div>
          <div style={{ fontSize: 76, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02, color: "#b93000" }}>Get tipped on Mezo.</div>
          <div style={{ fontSize: 30, color: "#635855", marginTop: 32 }}>One link and a QR code. Tips go straight to your wallet.</div>
        </div>
        <div style={{ width: 28, height: "100%", background: "#cf3d0b" }} />
      </div>
    ),
    size,
  );
}
