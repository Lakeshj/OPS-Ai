/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
