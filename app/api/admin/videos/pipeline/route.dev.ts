import { NextResponse } from 'next/server';

import { readiness } from '@/lib/admin-video';
import { isPipelineStep } from '@/lib/admin-video-pipeline';
import { frameListBuiltAtMs, guard, runPipelineStep } from '@/lib/admin-video-server';

/**
 * POST /api/admin/videos/pipeline/  { id, step: 'anchors' | 'rallies' | 'confirm' | 'frames', ...fields }
 * Runs the matching gamepath_video CLI command with an argument array and returns the fresh asset and its readiness.
 *   anchors: { firstServeSec, setEndSec, captureSpeed, serverOffCamera }
 *   rallies: { rallies: [{ serve, dead }] }   (seconds)
 */
export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.id !== 'string' || !isPipelineStep(body.step)) {
    return NextResponse.json({ ok: false, error: 'Expected { id, step: anchors | rallies | confirm | frames }.' }, { status: 400 });
  }
  try {
    const result = await runPipelineStep(body.id, body.step, body);
    const fresh = result.asset;
    return NextResponse.json(
      { ...result, asset: undefined, readiness: fresh ? readiness(fresh, { frameListBuiltAtMs: await frameListBuiltAtMs(fresh) }) : undefined },
      { status: result.ok ? 200 : 422 },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
