import { NextResponse } from 'next/server';

import { guard, videoFileResponse } from '@/lib/admin-video-server';

/** GET /api/admin/videos/file/?id=<asset id>: the registered recording, with HTTP Range support for the Prepare panel's player. */
export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id.' }, { status: 400 });
  try {
    return await videoFileResponse(request, id);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function HEAD(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response(null, { status: 400 });
  try {
    return await videoFileResponse(request, id, true);
  } catch {
    return new Response(null, { status: 500 });
  }
}
