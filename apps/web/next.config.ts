import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@nyambika/i18n", "@nyambika/contracts"],
  turbopack: {
    // Browser bundles compile the contracts from their ESM source so zod tree-shakes (the CommonJS dist pulled
    // the whole of zod + every locale, ~80 KB gz, into every route). The server keeps using dist.
    // The zod-free subpaths (JS budget pass) keep schema code out of client routes entirely: a module that is
    // imported at all keeps its top-level `z.object(...)` calls, so client components import these instead.
    resolveAlias: {
      "@nyambika/contracts/money": { browser: "../../packages/contracts/src/money.ts" },
      "@nyambika/contracts/region-data": { browser: "../../packages/contracts/src/region-data.ts" },
      "@nyambika/contracts/tailor-data": { browser: "../../packages/contracts/src/tailor-data.ts" },
      "@nyambika/contracts/ambient-model": { browser: "../../packages/contracts/src/ambient-model.ts" },
      "@nyambika/contracts": { browser: "../../packages/contracts/src/index.ts" },
    },
  },
  poweredByHeader: false,
  // `NEXT_DIST_DIR=.next-build next build` measures a production bundle while `next dev` keeps using .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  devIndicators: false,
  // Migration bundles embed product photos; the API enforces its own per-route limits.
  experimental: { proxyClientMaxBodySize: "40mb" },
  async rewrites() {
    // Same-origin API so auth cookies stay first-party.
    return [{ source: "/api/:path*", destination: `${API}/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
