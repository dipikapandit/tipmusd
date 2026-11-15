import type { MetadataRoute } from "next";
import { SITE } from "@/lib/client/site";

/** Static pages only. Creator pages are discovered through the links creators share. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE.url}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE.url}/start`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/explore`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${SITE.url}/developers`, changeFrequency: "monthly", priority: 0.5 },
  ];
}
