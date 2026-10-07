import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  // The phone opens the dev server through the Windows hotspot address.
  allowedDevOrigins: ['192.168.137.1'],
  basePath: isGitHubActions ? '/gamepath' : '',
  assetPrefix: isGitHubActions ? '/gamepath/' : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
