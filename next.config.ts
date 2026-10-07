import { spawn } from 'node:child_process';
import net from 'node:net';
import type { NextConfig } from "next";

const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';

if (process.env.NODE_ENV === 'development' && process.env.GAMEPATH_LIVE_SPAWNED !== '1') {
  const probe = net.connect({ port: 3850, host: '127.0.0.1' });
  probe.once('connect', () => probe.end());
  probe.once('error', () => {
    const child = spawn('npx', ['tsx', 'scripts/live-server.ts'], {
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: true,
      cwd: process.cwd(),
      env: { ...process.env, GAMEPATH_LIVE_SPAWNED: '1' },
    });
    child.unref();
  });
}

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
