/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // SSE del agente: sin compresión para que el streaming no se bufferice
  compress: false,
  // Las investigaciones tardan 30-90s; el proxy de rewrites corta a los 30s
  // por defecto y devolvía 500. Se amplía a 3 minutos.
  experimental: {
    proxyTimeout: 180_000,
  },
  async rewrites() {
    const backend = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/health", destination: `${backend}/health` },
    ];
  },
};

module.exports = nextConfig;
