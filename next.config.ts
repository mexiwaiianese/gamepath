import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: isGitHubActions ? '/gamepath' : '',
  assetPrefix: isGitHubActions ? '/gamepath/' : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
