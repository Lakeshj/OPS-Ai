/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Same-origin API: browser can call http://host:3001/api/...
   * Next proxies to the Express backend (default http://127.0.0.1:5013).
   */
  async rewrites() {
    const backend =
      process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:5013";
    return [
      {
        source: "/api/:path*",
        destination: `${backend.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
