import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static/ffprobe-static resolve their binary paths via __dirname at
  // require time; bundling them breaks that lookup, so they must run through
  // native require.
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static', 'fluent-ffmpeg'],
};

export default nextConfig;
