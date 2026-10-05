import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // ffmpeg-static locates its binary relative to its own folder, so it must not be bundled.
  serverExternalPackages: ["ffmpeg-static", "web-push"],
  outputFileTracingIncludes: {
    "/api/cron/tick": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/admin/tick": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
