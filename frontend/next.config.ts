import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Route all `sonner` imports through our react-toastify wrapper so existing
   * workflow/app toast.success/error calls get toastify UI (progress + colors).
   */
  turbopack: {
    resolveAlias: {
      sonner: "./src/lib/toast.ts",
    },
  },
  webpack: (config, { dir }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      sonner: path.join(dir, "src/lib/toast.ts"),
    };
    return config;
  },
  /**
   * Browser calls /api/auth/login → Next strips /api → backend /auth/login
   * Backend mounts all routes at / (no /api prefix).
   */
  async rewrites() {
    const backend = (
      process.env.BACKEND_INTERNAL_URL || "http://localhost:5013"
    ).replace(/\/$/, "");

    return [
      {
        source: "/api/:path*",
        destination: `${backend}/:path*`,
      },
      {
        source: "/api",
        destination: `${backend}/`,
      },
    ];
  },
};

export default nextConfig;
