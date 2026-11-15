import type { CreateProfileRequest, CreatorProfile, UpdateProfileRequest } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { json, parseBody, route } from "@/lib/server/http";
import { createProfile, requireProfileRow, toCreatorProfile, updateProfile } from "@/lib/server/profiles";
import { zCreateProfile, zUpdateProfile } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<CreatorProfile> => {
  const s = await requireSession(sql, req);
  return toCreatorProfile(await requireProfileRow(sql, s.userId));
});

export const POST = route(
  async (req, { sql }) => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zCreateProfile);
    return json(await createProfile(sql, s, body as CreateProfileRequest), { status: 201 });
  },
  { rateLimit: { bucket: "profile-create", limit: 10, windowSec: 60 } },
);

export const PATCH = route(
  async (req, { sql }): Promise<CreatorProfile> => {
    const s = await requireSession(sql, req);
    const body = (await parseBody(req, zUpdateProfile)) as UpdateProfileRequest;
    return updateProfile(sql, s, body);
  },
  { rateLimit: { bucket: "profile-update", limit: 30, windowSec: 60 } },
);
