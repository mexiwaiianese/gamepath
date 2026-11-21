import { NextResponse } from 'next/server';

import { guard } from '@/lib/admin-access';
import { TaggerConflictError, TaggerValidationError } from '@/lib/tagger-roster';
import { taggerRosterStore } from '@/lib/tagger-roster-store';

export async function GET(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  return NextResponse.json({ taggers: await taggerRosterStore().list() });
}

export async function POST(request: Request) {
  const blocked = guard(request);
  if (blocked) return blocked;
  const body = await request.json().catch(() => null);
  try {
    const tagger = await taggerRosterStore().create(body);
    return NextResponse.json({ tagger }, { status: 201 });
  } catch (error) {
    return rosterError(error);
  }
}

export function rosterError(error: unknown): NextResponse {
  if (error instanceof TaggerValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof TaggerConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  throw error;
}
