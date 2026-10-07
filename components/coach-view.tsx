'use client';

import SharedMatchReport from '@/components/shared-match-report';

type CoachViewProps = { matchId: string; token: string; onChangeMode: () => void };

export default function CoachView({ matchId, token, onChangeMode }: CoachViewProps) {
  return <div className="min-h-screen bg-slate-950 text-slate-50">
    <div className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-4">
      <p className="text-xs uppercase tracking-wider text-emerald-300">Coach</p>
      <button type="button" onClick={onChangeMode} className="rounded border border-slate-700 px-2 py-1 text-xs">CHANGE MODE</button>
    </div>
    <SharedMatchReport matchId={matchId} token={token} />
  </div>;
}
