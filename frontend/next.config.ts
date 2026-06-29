import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enable React strict mode — catches common bugs early in development
  reactStrictMode: true,

  // =============================================================================
  // STANDALONE OUTPUT — Required for Docker production builds
  // =============================================================================
  // Next.js `standalone` mode creates a self-contained `.next/standalone/` folder
  // that includes only what's needed to run the server — no node_modules needed.
  // This reduces the Docker image from ~1GB to ~200MB.
  //
  // How it works:
  //   1. Next.js traces all required files during build
  //   2. Copies only those files + a minimal server.js
  //   3. Docker copies `.next/standalone` + `.next/static` + `public` folders
  //
  // INTERVIEW QUESTION: "How do you optimize a Next.js Docker image?"
  // Answer: Use output: 'standalone' + multi-stage build. The builder stage
  // runs `next build` producing the standalone bundle. The runner stage copies
  // only the standalone output — no devDependencies, no source files.
  // =============================================================================
  output: 'standalone',

  // Image domains for Next.js Image component
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
};

export default nextConfig;
