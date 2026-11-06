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
  // Static export for builds. `next dev` runs as a normal server so the local admin portal (app/admin,
  // app/api/admin, written as *.dev.tsx / *.dev.ts) can use route handlers; builds never include those files.
  output: process.env.NODE_ENV === 'development' ? undefined : 'export',
  pageExtensions: process.env.NODE_ENV === 'development' ? ['dev.tsx', 'dev.ts', 'tsx', 'ts', 'jsx', 'js'] : ['tsx', 'ts', 'jsx', 'js'],
  trailingSlash: true,
  // `next dev` writes route types for the dev-only admin pages to .next/dev; keep them out of the build type check.
  typescript: { tsconfigPath: process.env.NODE_ENV === 'development' ? 'tsconfig.json' : 'tsconfig.build.json' },
  // Phones open the dev server by the computer's LAN address (hotspot or the Wi-Fi it is joined to).
  allowedDevOrigins: ['127.0.0.1', '[::1]', '192.168.137.1', '192.168.*.*'],
  basePath: isGitHubActions ? '/gamepath' : '',
  assetPrefix: isGitHubActions ? '/gamepath/' : undefined,
  images: { unoptimized: true },
};

export default nextConfig;
