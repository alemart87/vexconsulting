/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // SSE del agente: sin compresión para que el streaming no se bufferice
  compress: false,
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
    ];
  },
};

module.exports = nextConfig;
