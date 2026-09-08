import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Runtime state is mounted under /data in production. Never copy a
  // developer's local config, database, or session secret into the image.
  outputFileTracingExcludes: {
    "/*": ["./settings.yaml", "./data/**/*", "./data/.session_secret"],
  },
};

export default nextConfig;
