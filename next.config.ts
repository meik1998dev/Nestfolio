import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited page segments in the per-browser router cache for five
    // minutes. Authenticated routes remain request-rendered on a cold visit,
    // but revisiting them within this window reuses the RSC payload instead of
    // showing the streamed skeleton and querying Supabase again.
    staleTimes: {
      dynamic: 300,
      static: 300,
    },
  },
};

export default nextConfig;
