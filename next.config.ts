import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The seller form accepts up to five 10 MB evidence images in one
    // Server Action request. Keep a little room for multipart overhead.
    serverActions: {
      bodySizeLimit: "60mb",
    },
  },
};

export default nextConfig;
