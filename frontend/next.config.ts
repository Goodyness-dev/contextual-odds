import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';
    return [
      {
        source: '/api/signal/:path*',
        destination: `${apiUrl}/api/signal/:path*`,
      },
    ];
  },
};

export default nextConfig;