import { getAvatar } from "@/lib/server/profiles";
import { route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Uploaded avatar bytes. Immutable caching when ?v= matches the current etag (the URL changes on re-upload). */
export const GET = route<{ username: string }>(async (req, { sql, params }) => {
  const img = await getAvatar(sql, params.username ?? "");
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (!img) return new Response("Not found", { status: 404, headers: { ...headers, "cache-control": "public, max-age=60" } });
  const etag = `"${img.etag}"`;
  const v = new URL(req.url).searchParams.get("v");
  headers["etag"] = etag;
  headers["cache-control"] = v === img.etag ? "public, max-age=31536000, immutable" : "public, max-age=300";
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(img.bytes), { status: 200, headers: { ...headers, "content-type": img.contentType } });
});
