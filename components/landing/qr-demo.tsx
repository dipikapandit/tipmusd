import QRCode from "qrcode";

/** A real, scannable QR (server-rendered SVG) that opens /start on a phone. */
export async function QrDemo({ url }: { url: string }) {
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1513", light: "#00000000" } });
  return (
    <div
      role="img"
      aria-label={`QR code that opens ${url}`}
      className="size-full [&>svg]:size-full"
      // qrcode output is a generated SVG from our own URL, not user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
