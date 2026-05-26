import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
  // better-sqlite3 is an optional native dependency. Keep it external so
  // production builds do not try to bundle/resolve it on hosts that run the
  // JSON fallback store.
  serverExternalPackages: ["better-sqlite3"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean)), { "better-sqlite3": "commonjs better-sqlite3" }];
    }
    return config;
  },
};

export default nextConfig;
