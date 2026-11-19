import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Dev only: lets the dev server's scripts/HMR load when the app is opened through an ngrok tunnel (otherwise the page never hydrates).
  allowedDevOrigins: ["*.ngrok.app", "*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.dev", "*.ngrok.io"],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  serverExternalPackages: ["pg", "bcryptjs"],
  async headers() {
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
    ];
    // The API only ever returns JSON / files: forbid everything else if a response is ever rendered, and keep proxies/browsers from caching private data.
    const api = [
      { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ];
    return [{ source: "/:path*", headers: common }, { source: "/api/:path*", headers: api }];
  },
  turbopack: {
    root: path.resolve(__dirname),
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
