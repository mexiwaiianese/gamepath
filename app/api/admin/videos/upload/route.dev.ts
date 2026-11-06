import { promises as fs } from 'node:fs';

import { NextResponse } from 'next/server';

import { parseAttestation } from '@/lib/admin-video';
import { guard, registerVideo, saveStream, uniqueVideoPath } from '@/lib/admin-video-server';

/** Stream one raw file body into videos/ and register it. Query: ?name=<file name>&attestation=<json>. */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const query = new URL(request.url).searchParams;
  const name = query.get('name') || 'video.mp4';
  let attestation = {};
  try {
    attestation = parseAttestation(JSON.parse(query.get('attestation') || '{}'));
  } catch {
    return NextResponse.json({ ok: false, name, error: 'Bad attestation.' }, { status: 400 });
  }
  if (!request.body) return NextResponse.json({ ok: false, name, error: 'Empty upload.' }, { status: 400 });
  try {
    const dest = await uniqueVideoPath(name);
    await saveStream(request.body, dest);
    const result = await registerVideo(dest, attestation);
    if (!result.asset) await fs.rm(dest, { force: true });
    return NextResponse.json({ ...result, name });
  } catch (error) {
    return NextResponse.json({ ok: false, name, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
