import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';

import { NextResponse } from 'next/server';

import { TAGGERS, parseAttestation, parseUrlList, readiness, youTubeLink } from '@/lib/admin-video';
import { defaultAssetId } from '@/lib/admin-video-pipeline';
import { downloadYouTube, frameListBuiltAtMs, guard, readAssets, registerVideo, saveStream, uniqueVideoPath, type RegisterResult } from '@/lib/admin-video-server';

export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const assets = await readAssets();
  const videos = await Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      fileExists: existsSync(asset.path),
      readiness: readiness(asset, { frameListBuiltAtMs: await frameListBuiltAtMs(asset) }),
    })),
  );
  // Which recording each marker opens when no video is picked (same rule as marker.choose_asset; assets are in registry order here).
  const defaults = Object.fromEntries(TAGGERS.map((tagger) => [tagger.id, defaultAssetId(tagger.id, assets)]));
  return NextResponse.json({ videos: videos.reverse(), defaults });
}

/** Download each URL into videos/ and register it. Body: { urls: string | string[], attestation }. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { urls?: string | string[]; attestation?: unknown };
  const text = Array.isArray(body.urls) ? body.urls.join('\n') : String(body.urls ?? '');
  const { urls, invalid } = parseUrlList(text);
  const attestation = parseAttestation(body.attestation);
  const results: (RegisterResult & { source: string })[] = invalid.map((line) => ({ ok: false, name: line, source: line, error: 'Not an http(s) URL.' }));
  for (const url of urls) {
    const youtube = youTubeLink(url);
    if (youtube) {
      const { files, error } = await downloadYouTube(youtube);
      if (!files.length) {
        results.push({ ok: false, name: url, source: url, error: error ?? 'yt-dlp saved nothing.' });
        continue;
      }
      for (const file of files) results.push({ ...(await registerVideo(file, attestation)), source: url });
      if (error) results.push({ ok: false, name: url, source: url, error: `Some playlist items failed: ${error}` });
      continue;
    }
    const fallback = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video');
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (type.startsWith('text/html')) throw new Error('URL returned a web page, not a video file.');
      const dest = await uniqueVideoPath(fallback);
      await saveStream(response.body, dest);
      const result = await registerVideo(dest, attestation);
      if (!result.asset) await fs.rm(dest, { force: true });
      results.push({ ...result, source: url });
    } catch (error) {
      results.push({ ok: false, name: fallback, source: url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return NextResponse.json({ results });
}
