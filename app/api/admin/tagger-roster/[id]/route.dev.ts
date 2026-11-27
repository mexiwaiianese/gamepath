import { NextResponse } from 'next/server';

import { guard } from '@/lib/admin-access';
import { TaggerNotFoundError } from '@/lib/tagger-roster';
import { taggerRosterStore } from '@/lib/tagger-roster-store';

import { rosterError } from '../route.dev';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const store = taggerRosterStore();
  try {
    if (body && body.action === 'deactivate') {
      return NextResponse.json({ tagger: await store.deactivate(id) });
    }
    if (body && body.action === 'reactivate') {
      return NextResponse.json({ tagger: await store.reactivate(id) });
    }
    if (body && body.action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ tagger: await store.update(id, body) });
  } catch (error) {
    if (error instanceof TaggerNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    return rosterError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const { id } = await context.params;
  const removed = await taggerRosterStore().remove(id);
  if (!removed) return NextResponse.json({ error: 'Tagger not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
