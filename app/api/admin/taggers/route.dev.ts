import { NextResponse } from 'next/server';

import { TAGGERS, findTagger } from '@/lib/admin-video';
import { forceStopTagger, guard, startTagger, stopTagger, taggerStatus } from '@/lib/admin-video-server';

export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  return NextResponse.json({ taggers: await Promise.all(TAGGERS.map(taggerStatus)) });
}

export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; asset?: string; review?: string };
  const tagger = findTagger(body.id);
  if (!tagger) return NextResponse.json({ error: 'Unknown tagger.' }, { status: 400 });
  if (body.action === 'start') {
    const result = await startTagger(tagger, { asset: body.asset || null, review: body.review || null });
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (body.action === 'stop') {
    const result = await stopTagger(tagger);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  if (body.action === 'force-stop') {
    const result = await forceStopTagger(tagger);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }
  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
