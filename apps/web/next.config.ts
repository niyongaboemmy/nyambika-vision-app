import type { NextConfig } from "next";

const API = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@nyambika/i18n"],
  poweredByHeader: false,
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
