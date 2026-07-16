import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: ".next",
  outputFileTracingRoot: __dirname,
  async rewrites() {
    return [
      {
        source: '/api/signal/:path*',
        destination: 'http://127.0.0.1:3001/api/signal/:path*',
      },
    ];
  },
};

export default nextConfig;