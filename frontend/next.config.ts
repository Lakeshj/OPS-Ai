/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Same-origin API: browser calls /api/...
   * Next proxies to backend /api/... (backend also serves bare / in production
   * for nginx setups that strip the /api prefix).
   */
  async rewrites() {
    const backend = (
      process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:5013"
    ).replace(/\/$/, "");

    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
