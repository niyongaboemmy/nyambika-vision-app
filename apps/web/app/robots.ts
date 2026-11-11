import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.PUBLIC_WEB_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: ["/", "/makers", "/m/"], disallow: ["/api/", "/studio", "/admin", "/looks", "/orders", "/mirror", "/trust", "/dev"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
