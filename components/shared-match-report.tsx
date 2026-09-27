'use client';

import { useEffect, useState } from 'react';
import { calculateTeamStats } from '@/lib/volleyball';

type ReportEvent = { eventType: string; team: string; athleteId?: string | null };
type ReportMatch = {
  team: string;
  opponent: string;
  seasonName: string;
  numberOfSets: number;
  scoringType: 'rally' | 'side-out';
  pointsToWin: number;
  set: number;
  score: { home: number; away: number };
  rallies: Array<{ events: ReportEvent[] }>;
  current: ReportEvent[];
};
type ShareResponse = { match: ReportMatch; updatedAt: string };

type SharedMatchReportProps = {
  matchId: string;
  token: string;
};

export default function SharedMatchReport({ matchId, token }: SharedMatchReportProps) {
  const [match, setMatch] = useState<ReportMatch | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'live' | 'offline' | 'unavailable'>('loading');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const query = new URLSearchParams({ token });
        const response = await fetch(`/api/matches/${encodeURIComponent(matchId)}?${query}`, { cache: 'no-store' });
        if (!response.ok) {
          if (active) setStatus(response.status === 404 || response.status === 403 ? 'unavailable' : 'offline');
          return;
        }
        const data = await response.json() as ShareResponse;
        if (active) {
          setMatch(data.match);
          setUpdatedAt(data.updatedAt);
          setStatus('live');
        }
      } catch {
        if (active) setStatus('offline');
      }
    };

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [matchId, token]);

  if (!match) {
    return <main className="mx-auto min-h-screen max-w-3xl space-y-4 p-4 text-slate-100 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-300">GamePath · Live report</p>
      <h1 className="text-xl font-semibold">{status === 'loading' ? 'Connecting to match…' : status === 'offline' ? 'Report host unavailable' : 'Match report unavailable'}</h1>
      <p className="text-sm text-slate-400">{status === 'offline' ? 'Reconnect to the team network and this page will retry automatically.' : status === 'unavailable' ? 'This link is invalid or the match has not synced to its host yet.' : 'Waiting for the host to publish this match.'}</p>
      <p className="text-xs text-slate-500">The match host must be running and reachable on the same local network.</p>
    </main>;
  }

  const events = [...match.rallies.flatMap((rally) => rally.events), ...match.current].map((event) => ({
    eventType: event.eventType,
    team: event.team,
    athleteId: event.athleteId ?? undefined,
  }));
  const stats = calculateTeamStats(events);

  return <main className="mx-auto min-h-screen max-w-3xl space-y-4 p-4 text-slate-100 sm:p-8">
    <header className="border-b border-slate-700 pb-4">
      <p className="text-xs font-bold uppercase tracking-widest text-sky-300">GamePath · Live report</p>
      <h1 className="mt-2 text-xl font-semibold">{match.team} vs {match.opponent}</h1>
      <p className="mt-1 text-sm text-slate-400">{match.seasonName} · Set {match.set} of {match.numberOfSets} · {match.scoringType === 'rally' ? 'Rally' : 'Side-out'} scoring to {match.pointsToWin}</p>
      <p className="mt-2 text-xs text-emerald-300">{status === 'live' ? 'LIVE · refreshes every 2.5 seconds' : 'Reconnecting…'}{updatedAt ? ` · Updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}</p>
    </header>

    <section className="flex items-end justify-between rounded border border-slate-700 bg-slate-900 p-4">
      <div><p className="text-xs uppercase tracking-wider text-slate-400">{match.team}</p><strong className="text-3xl tabular-nums">{match.score.home}</strong></div>
      <span className="pb-1 text-sm text-slate-500">SET {match.set}</span>
      <div className="text-right"><p className="text-xs uppercase tracking-wider text-slate-400">{match.opponent}</p><strong className="text-3xl tabular-nums">{match.score.away}</strong></div>
    </section>

    <section>
      <h2 className="mb-2 text-sm font-semibold">Team stats</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Aces" value={stats.aces} />
        <Metric label="Digs" value={stats.digs} />
        <Metric label="Reception errors" value={stats.receptionErrors} />
        <Metric label="Avg. reception" value={stats.averageReceptionRating.toFixed(2)} />
      </div>
    </section>

    <section className="border-t border-slate-800 pt-4">
      <h2 className="text-sm font-semibold">Match activity</h2>
      <p className="mt-1 text-sm text-slate-400">{match.rallies.length} completed rallies recorded.</p>
      {match.current.length > 0 && <p className="mt-2 text-sm text-slate-300">Current rally: {match.current.map((event) => event.eventType.replaceAll('_', ' ')).join(' · ')}</p>}
    </section>

    <section className="border-t border-slate-800 pt-4">
      <h2 className="text-sm font-semibold">Insights and video evidence</h2>
      <p className="mt-1 text-sm text-slate-400">Automated recommendations and linked video snippets are not connected yet. This report currently shows live score and recorded team stats only.</p>
    </section>
    <p className="text-xs text-slate-500">Private team link. Anyone who has this link can view the match report while the host is available.</p>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded border border-slate-800 bg-slate-900 p-3"><p className="text-xs text-slate-400">{label}</p><strong className="mt-1 block text-xl tabular-nums">{value}</strong></div>;
}
