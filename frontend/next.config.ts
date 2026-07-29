/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  /**
   * Same-origin API: browser can call /api/...
   * Local: Next proxies to backend /api/...
   * Production: Next proxies to backend /... (nginx often strips /api too)
   */
  async rewrites() {
    const backend = (
      process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:5013"
    ).replace(/\/$/, "");
    const isProduction = process.env.NODE_ENV === "production";
    const backendPrefix = isProduction ? "" : "/api";

    return [
      {
        source: "/api/:path*",
        destination: `${backend}${backendPrefix}/:path*`,
      },
    ];
  },
};

export default nextConfig;
