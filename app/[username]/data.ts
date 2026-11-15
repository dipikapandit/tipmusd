import "server-only";
import { cache } from "react";
import { getPublicCreator, getPublicTips } from "@/lib/server/creators";

/** Deduped per request: generateMetadata, the page and the OG image all read the same creator. */
export const loadCreator = cache((username: string, campaign: string | null) => getPublicCreator(username, campaign));
export const loadTips = cache((username: string) => getPublicTips(username, { limit: 12 }));
