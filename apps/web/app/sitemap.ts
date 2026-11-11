import type { MetadataRoute } from "next";
import { serverApi } from "@/lib/server-api";

/** SEO Maker Spaces (FR-DIR-10). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
  const pages = (await serverApi<{ handle: string }[]>("/pages", 300)) ?? [];
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/makers`, changeFrequency: "daily", priority: 0.8 },
    ...pages.map((p) => ({ url: `${base}/m/${p.handle}`, changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
