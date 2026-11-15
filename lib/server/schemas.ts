// zod request schemas for /api/profile/* (semantic checks — amounts, links, text cleaning — live in lib/server/profiles.ts).
import { z } from "zod";
import { ACCENTS, AVATAR_PRESETS } from "@/lib/api-types";

const zSocial = z.object({ kind: z.string().max(20), url: z.string().max(300) });
const zAmount = z.string().max(32);

export const zCreateProfile = z.object({
  username: z.string().min(1).max(64),
  displayName: z.string().max(200),
  bio: z.string().max(2000).optional(),
  avatarPreset: z.enum(AVATAR_PRESETS).optional(),
  socialLinks: z.array(zSocial).max(20).optional(),
  suggestedAmounts: z.array(zAmount).max(20).optional(),
  defaultAmount: zAmount.optional(),
});

export const zUpdateProfile = z.object({
  username: z.string().min(1).max(64).optional(),
  displayName: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  avatarPreset: z.enum(AVATAR_PRESETS).nullable().optional(),
  socialLinks: z.array(zSocial).max(20).optional(),
  suggestedAmounts: z.array(zAmount).max(20).optional(),
  defaultAmount: zAmount.optional(),
  thankYouMessage: z.string().max(2000).optional(),
  accent: z.enum(ACCENTS as readonly [string, ...string[]]).optional(),
  publicActivityEnabled: z.boolean().optional(),
  anonymousTipsEnabled: z.boolean().optional(),
  messagesEnabled: z.boolean().optional(),
  acceptMezo: z.boolean().optional(),
});
