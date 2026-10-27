import type { NextConfig } from "next";

// The browser only talks to this origin: /api/* is proxied to the Express server, which
// talks to Supabase. API_URL is server-only and is read when next dev / next build starts.
const apiUrl = process.env.API_URL ?? "http://localhost:5000";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
