// Avatar upload validation: data URL → bytes, magic-byte sniffing (the declared type must match the bytes),
// size cap and pixel-dimension cap. Never trusts the client's content type.
import { createHash } from "node:crypto";
import { HttpError } from "./errors";

export const AVATAR_MAX_BYTES = 200 * 1024;
export const AVATAR_MAX_PX = 1024;
export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export interface ParsedImage {
  contentType: ImageType;
  bytes: Buffer;
  width: number;
  height: number;
  etag: string;
}

function sniff(b: Buffer): ImageType | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Pixel dimensions from the image header, or null if it can't be read. */
export function imageSize(type: ImageType, b: Buffer): { width: number; height: number } | null {
  try {
    if (type === "image/png") {
      if (b.toString("latin1", 12, 16) !== "IHDR") return null;
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        if (marker === 0xff) {
          i++;
          continue;
        }
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          i += 2;
          continue;
        }
        const len = b.readUInt16BE(i + 2);
        // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    // WebP
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8 ") return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
      return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
    }
    if (chunk === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    return null;
  } catch {
    return null;
  }
}

/** data:image/(png|jpeg|webp);base64,... → validated image. Throws 400 invalid_image / 413 image_too_large. */
export function parseAvatarDataUrl(dataUrl: string): ParsedImage {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl ?? "");
  if (!m) throw new HttpError(400, "invalid_image", "Upload a PNG, JPEG or WebP image");
  const declared = (m[1] === "image/jpg" ? "image/jpeg" : m[1]) as ImageType;
  const bytes = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (bytes.length === 0) throw new HttpError(400, "invalid_image", "The image is empty");
  if (bytes.length > AVATAR_MAX_BYTES) throw new HttpError(413, "image_too_large", "Images must be 200 KB or smaller");
  const actual = sniff(bytes);
  if (!actual || actual !== declared) throw new HttpError(400, "invalid_image", "That file isn't a valid PNG, JPEG or WebP image");
  const size = imageSize(actual, bytes);
  if (!size || size.width < 1 || size.height < 1) throw new HttpError(400, "invalid_image", "Couldn't read the image size");
  if (size.width > AVATAR_MAX_PX || size.height > AVATAR_MAX_PX)
    throw new HttpError(400, "image_too_large", `Images must be at most ${AVATAR_MAX_PX}×${AVATAR_MAX_PX} pixels`);
  const etag = createHash("sha256").update(bytes).digest("hex").slice(0, 20);
  return { contentType: actual, bytes, ...size, etag };
}
