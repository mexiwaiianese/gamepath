'use client';

import { useSearchParams } from 'next/navigation';
import SharedMatchReport from '@/components/shared-match-report';

export default function ReportGate() {
  const params = useSearchParams();
  const matchId = params.get('match') ?? '';
  const token = params.get('token') ?? '';
  if (!matchId || !token) {
    return <main className="mx-auto min-h-screen max-w-3xl space-y-4 p-4 text-slate-100 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-300">GamePath · Live report</p>
      <h1 className="text-xl font-semibold">Match report unavailable</h1>
      <p className="text-sm text-slate-400">Open the private link from the scorer’s SHARE button.</p>
    </main>;
  }
  return <SharedMatchReport matchId={matchId} token={token} />;
}
