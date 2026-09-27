'use client';

import { useEffect, useRef, useState } from 'react';
import TeamSetup from '@/components/team-setup';
import NewMatchDialog from '@/components/new-match-dialog';
import MatchShareDialog from '@/components/match-share-dialog';
import { isLibero, migrateAthlete, normalizeSeasonStarters, pointAwardedTo, type Athlete, type Coach, type MatchSetup, type Season, type TeamProfile } from '@/lib/team-data';
import { calculatePlayerStats } from '@/lib/volleyball';
import { deriveAssistEventIds, humanEventLabel, nextInferredEventType, resolveServeStateAfterPoint, type TeamSide } from '@/lib/rally-engine';
import { nextActionGuidance } from '@/lib/rally-state';

type View = 'match' | 'roster';
type CourtOrientation = 'bottom' | 'top' | 'left' | 'right';
type Event = { id: string; eventType: string; athleteId: string | null; team: TeamSide };
type Score = { home: number; away: number };
type Rally = { id: string; number: number; scoreBefore: Score; scoreAfter: Score; winner: TeamSide; events: Event[]; flagged?: boolean };
type Match = { id: string; team: string; opponent: string; seasonId: string; seasonName: string; numberOfSets: number; scoringType: 'rally' | 'side-out'; pointsToWin: number; startingLineup: Athlete[]; liberos: Athlete[]; shareToken?: string; set: number; score: Score; serving: TeamSide; serverId: string | null; lineup: string[]; visualLineup: string[]; current: Event[]; rallies: Rally[] };

const storageKey = 'gamepath-live-match-v3';
const rosterSeed: Athlete[] = [
  { id: 'a1', jersey: 1, firstName: 'Maya', lastName: 'Chen', positions: ['Libero'], libero: true },
  { id: 'a2', jersey: 3, firstName: 'Jasmine', lastName: 'Ortiz', positions: ['Outside Hitter'] },
  { id: 'a3', jersey: 5, firstName: 'Ava', lastName: 'Brooks', positions: ['Middle Blocker'] },
  { id: 'a4', jersey: 7, firstName: 'Sofia', lastName: 'Reed', positions: ['Setter'] },
  { id: 'a5', jersey: 9, firstName: 'Nia', lastName: 'Patel', positions: ['Opposite'] },
  { id: 'a6', jersey: 11, firstName: 'Lena', lastName: 'Foster', positions: ['Outside Hitter'] },
  { id: 'a7', jersey: 15, firstName: 'Ella', lastName: 'Nguyen', positions: ['Middle Blocker'] },
  { id: 'a8', jersey: 18, firstName: 'Harper', lastName: 'Singh', positions: ['Defensive Specialist'] },
];

function makeId(prefix: string) { return `${prefix}-${Math.random().toString(36).slice(2, 9)}`; }
function makeShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const defaultSeason: Season = { id: 'season-2026-fall', name: '2026 Fall', starters: rosterSeed.filter((athlete) => !isLibero(athlete)).slice(0, 6).map((athlete) => athlete.id) };
const defaultTeam: TeamProfile = { district: '', schoolName: 'North Valley High', level: 'varsity', grade: '' };
function initialMatch(team = defaultTeam, season = defaultSeason): Match {
  const startingLineup = season.starters.map((id) => rosterSeed.find((athlete) => athlete.id === id)).filter((athlete): athlete is Athlete => !!athlete && !isLibero(athlete));
  const lineup = startingLineup.map((athlete) => athlete.id);
  return { id: 'match-initial', team: team.schoolName, opponent: 'Riverton Prep', seasonId: season.id, seasonName: season.name, numberOfSets: 5, scoringType: 'rally', pointsToWin: 25, startingLineup, liberos: rosterSeed.filter(isLibero), set: 1, score: { home: 0, away: 0 }, serving: 'home', serverId: lineup[0] ?? null, lineup, visualLineup: lineup, current: [], rallies: [] };
}
function compact(events: Event[], lookup: (id: string | null) => number | undefined) {
  const assists = deriveAssistEventIds(events);
  return events.flatMap((event) => {
    const prefix = event.athleteId ? `#${lookup(event.athleteId) ?? '?'} ` : '';
    const item = `${prefix}${humanEventLabel(event.eventType)}`;
    return assists.has(event.id) ? [item, `${prefix}Assist`] : [item];
  }).join(' → ') || 'Nothing Recorded';
}

export default function Home() {
  const [view, setView] = useState<View>('match');
  const [roster, setRoster] = useState<Athlete[]>(rosterSeed);
  const [match, setMatch] = useState<Match>(initialMatch);
  const [team, setTeam] = useState<TeamProfile>(defaultTeam);
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([defaultSeason]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(defaultSeason.id);
  const [archivedMatches, setArchivedMatches] = useState<Match[]>([]);
  const [newMatchOpen, setNewMatchOpen] = useState(false);
  const [matchesOpen, setMatchesOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareOrigin, setShareOrigin] = useState('');
  const [shareSyncStatus, setShareSyncStatus] = useState<{ matchId: string; status: 'pending' | 'ready' | 'failed' } | null>(null);
  const shareSyncQueue = useRef<Promise<void>>(Promise.resolve());
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);
  const [subIn, setSubIn] = useState<string | null>(null);
  const [selectingSubOut, setSelectingSubOut] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [courtDisplay, setCourtDisplay] = useState<'static' | 'rotate'>('static');
  const [courtOrientation, setCourtOrientation] = useState<CourtOrientation>('bottom');

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as { roster?: unknown[]; match?: Partial<Match>; team?: TeamProfile; coaches?: Coach[]; seasons?: Season[]; selectedSeasonId?: string; archivedMatches?: Match[]; courtDisplay?: 'static' | 'rotate'; courtOrientation?: CourtOrientation };
      if (parsed.roster && parsed.match) {
        const migratedRoster = parsed.roster.map((athlete) => migrateAthlete(athlete as Parameters<typeof migrateAthlete>[0]));
        const savedLineup = parsed.match.lineup ?? rosterSeed.slice(0, 6).map((athlete) => athlete.id);
        const loadedTeam = parsed.team ?? { ...defaultTeam, schoolName: parsed.match.team ?? defaultTeam.schoolName };
        const loadedSeasons = (parsed.seasons?.length ? parsed.seasons : [{
          ...defaultSeason,
          starters: parsed.match.startingLineup?.map((athlete) => athlete.id) ?? savedLineup,
        }]).map((season) => normalizeSeasonStarters(season, migratedRoster));
        const loadedSeasonId = loadedSeasons.some((season) => season.id === parsed.selectedSeasonId)
          ? parsed.selectedSeasonId!
          : loadedSeasons[0].id;
        const loadedSeason = loadedSeasons.find((season) => season.id === (parsed.match?.seasonId ?? loadedSeasonId)) ?? loadedSeasons[0];
        const defaultLoadedMatch = initialMatch(loadedTeam, loadedSeason);
        const startingLineup = parsed.match.startingLineup?.map((athlete) => migrateAthlete(athlete))
          ?? migratedRoster.filter((athlete) => savedLineup.includes(athlete.id));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate browser-only match data once
        setRoster(migratedRoster);
        setTeam(loadedTeam);
        setCoaches(parsed.coaches ?? []);
        setSeasons(loadedSeasons);
        setSelectedSeasonId(loadedSeasonId);
        setArchivedMatches((parsed.archivedMatches ?? []).map((archivedMatch) => ({
          ...archivedMatch,
          startingLineup: (archivedMatch.startingLineup ?? archivedMatch.lineup.map((id) => migratedRoster.find((athlete) => athlete.id === id)).filter((athlete): athlete is Athlete => !!athlete)).map((athlete) => migrateAthlete(athlete)),
          liberos: (archivedMatch.liberos ?? migratedRoster.filter(isLibero)).map((athlete) => migrateAthlete(athlete)),
        })));
        setMatch({ ...defaultLoadedMatch, ...parsed.match, id: parsed.match.id ?? makeId('match'), seasonId: parsed.match.seasonId ?? loadedSeason.id, seasonName: parsed.match.seasonName ?? loadedSeason.name, numberOfSets: parsed.match.numberOfSets ?? 5, scoringType: parsed.match.scoringType ?? 'rally', pointsToWin: parsed.match.pointsToWin ?? 25, startingLineup, liberos: (parsed.match.liberos ?? migratedRoster.filter(isLibero)).map((athlete) => migrateAthlete(athlete)), lineup: savedLineup, visualLineup: parsed.match.visualLineup ?? savedLineup });
        setCourtDisplay(parsed.courtDisplay ?? 'static');
        setCourtOrientation(['bottom', 'top', 'left', 'right'].includes(parsed.courtOrientation ?? '') ? parsed.courtOrientation! : 'bottom');
      }
    } catch { localStorage.removeItem(storageKey); }
  }, []);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ roster, match, team, coaches, seasons, selectedSeasonId, archivedMatches, courtDisplay, courtOrientation })); }, [roster, match, team, coaches, seasons, selectedSeasonId, archivedMatches, courtDisplay, courtOrientation]);
  useEffect(() => {
    if (!match.shareToken) return;
    const snapshot = match;
    shareSyncQueue.current = shareSyncQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch(`/api/matches/${encodeURIComponent(snapshot.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: snapshot.shareToken, match: snapshot }),
      });
      setShareSyncStatus({ matchId: snapshot.id, status: response.ok ? 'ready' : 'failed' });
    }).catch(() => {
      setShareSyncStatus({ matchId: snapshot.id, status: 'failed' });
    }).catch(() => undefined);
  }, [match]);

  const jerseyFor = (id: string | null) => roster.find((athlete) => athlete.id === id)?.jersey;
  const courtIds = courtDisplay === 'rotate'
    ? [match.lineup[0], match.lineup[5], match.lineup[4], match.lineup[1], match.lineup[2], match.lineup[3]].filter((id): id is string => !!id)
    : match.visualLineup;
  const courtSlots = courtIds.map((id, index) => ({ athlete: roster.find((athlete) => athlete.id === id), position: index + 1 })).filter((slot): slot is { athlete: Athlete; position: number } => !!slot);
  // Grid cells are filled in reading order; indices below select from courtSlots (index = position - 1)
  // so the numbers always trace the same clockwise cycle (4-3-2-1-6-5) no matter which edge the net is on.
  const orientationOrder: Record<CourtOrientation, number[]> = {
    top: [3, 2, 1, 4, 5, 0],
    right: [4, 3, 5, 2, 0, 1],
    bottom: [0, 5, 4, 1, 2, 3],
    left: [1, 0, 2, 5, 3, 4],
  };
  const court = orientationOrder[courtOrientation].map((index) => courtSlots[index]).filter((slot): slot is { athlete: Athlete; position: number } => !!slot);
  const courtIsVertical = courtOrientation === 'left' || courtOrientation === 'right';
  const netLineClass = {
    bottom: 'absolute bottom-1 left-2 right-2 h-0.5',
    top: 'absolute left-2 right-2 top-1 h-0.5',
    left: 'absolute bottom-2 left-1 top-2 w-0.5',
    right: 'absolute bottom-2 right-1 top-2 w-0.5',
  }[courtOrientation];
  const bench = roster.filter((athlete) => !isLibero(athlete) && !match.lineup.includes(athlete.id));
  const liberoPlayers = roster.filter(isLibero);
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId) ?? seasons[0];
  const activeServerId = pendingServerId ?? match.serverId;
  const guidance = nextActionGuidance(match.current, match.serving, jerseyFor(activeServerId) ?? null, !!pendingServerId);
  const liveNotation = `R${match.rallies.length + 1} ${match.score.home}-${match.score.away} ${compact(match.current, jerseyFor)}`;

  const addEvent = (eventType: string, athleteId: string | null) => setMatch((previous) => ({ ...previous, current: [...previous.current, { id: makeId('event'), eventType, athleteId, team: 'home' }] }));
  const endRally = (eventType: string, athleteId: string | null, winner: TeamSide) => {
    setMatch((previous) => {
      const scoreBefore = previous.score;
      const pointWinner = pointAwardedTo(previous.scoringType, previous.serving, winner);
      const scoreAfter = { home: pointWinner === 'home' ? scoreBefore.home + 1 : scoreBefore.home, away: pointWinner === 'away' ? scoreBefore.away + 1 : scoreBefore.away };
      const events = [...previous.current, { id: makeId('event'), eventType, athleteId, team: winner }];
      const serve = resolveServeStateAfterPoint({ servingTeam: previous.serving, lineup: previous.lineup, currentServerId: previous.serverId }, winner);
      return { ...previous, score: scoreAfter, serving: serve.servingTeam, serverId: serve.currentServerId, lineup: serve.lineup, current: [], rallies: [...previous.rallies, { id: makeId('rally'), number: previous.rallies.length + 1, scoreBefore, scoreAfter, winner, events }] };
    });
    setPendingServerId(null); setOverride(null); setBlockers([]); setSubIn(null); setSelectingSubOut(false);
  };
  const tapPlayer = (athleteId: string) => {
    if (selectingSubOut && subIn) { substitute(athleteId, subIn); return; }
    if (override === 'block') { setBlockers((items) => items.includes(athleteId) ? items.filter((id) => id !== athleteId) : [...items, athleteId]); return; }
    if (override) { addEvent(override, athleteId); setOverride(null); return; }
    const next = nextInferredEventType(match.current, match.serving);
    if (next === 'select_server') { setPendingServerId(athleteId); return; }
    if (match.current.at(-1)?.eventType === 'attack_attempt') addEvent('attack_in_play', match.current.at(-1)?.athleteId ?? null);
    addEvent(next, athleteId);
  };
  const action = (name: string) => {
    const last = match.current.at(-1);
    if (name === 'serve') { if (activeServerId) { addEvent('serve_attempt', activeServerId); setPendingServerId(null); } return; }
    if (name === 'ace' && last?.eventType === 'serve_attempt') return endRally('ace', last.athleteId, 'home');
    if (name === 'kill' && last?.eventType === 'attack_attempt') return endRally('kill', last.athleteId, 'home');
    if (name === 'dug' && last?.eventType === 'attack_attempt') { addEvent('attack_in_play', last.athleteId ?? null); setOverride(null); return; }
    if (name === 'blocked' && last?.eventType === 'attack_attempt') return endRally('attack_blocked', last.athleteId, 'away');
    if (name === 'error') { const type = override === 'block' ? 'block_error' : last?.eventType === 'serve_attempt' ? 'serve_error' : last?.eventType === 'reception_attempt' ? 'reception_error' : last?.eventType === 'set' ? 'setting_error' : 'attack_error'; return endRally(type, blockers[0] ?? last?.athleteId ?? null, 'away'); }
    if (name === 'point-for') return endRally('point_for', last?.athleteId ?? null, 'home');
    if (name === 'point-against') return endRally('point_against', last?.athleteId ?? null, 'away');
    if (name === 'confirm-block' && blockers.length) { blockers.forEach((id) => addEvent(blockers.length === 1 ? 'solo_block' : 'block_assist', id)); setBlockers([]); setOverride(null); return; }
    if (name === 'block') { setOverride('block'); setBlockers([]); return; }
    setOverride(name);
  };
  const substitute = (outId: string, inId: string) => {
    if (!match.lineup.includes(outId) || match.lineup.includes(inId)) return;
    addEvent('substitution', inId);
    setMatch((previous) => {
      const lineup = previous.lineup.map((id) => id === outId ? inId : id);
      return { ...previous, lineup, serverId: previous.serving === 'home' ? lineup[0] ?? null : null, visualLineup: previous.visualLineup.map((id) => id === outId ? inId : id) };
    });
    setSubIn(null);
    setSelectingSubOut(false);
  };
  const addSeason = (name: string) => {
    const season = { id: makeId('season'), name, starters: [] };
    setSeasons((items) => [...items, season]);
    setSelectedSeasonId(season.id);
  };
  const toggleStarter = (athleteId: string) => {
    if (roster.some((athlete) => athlete.id === athleteId && isLibero(athlete))) return;
    setSeasons((items) => items.map((season) => {
      if (season.id !== selectedSeasonId) return season;
      const starters = season.starters.includes(athleteId)
        ? season.starters.filter((id) => id !== athleteId)
        : season.starters.length < 6 ? [...season.starters, athleteId] : season.starters;
      return { ...season, starters };
    }));
  };
  const updateRoster = (nextRoster: Athlete[]) => {
    const activeIds = new Set(nextRoster.map((athlete) => athlete.id));
    setRoster(nextRoster);
    setSeasons((items) => items.map((season) => normalizeSeasonStarters({ ...season, starters: season.starters.filter((id) => activeIds.has(id)) }, nextRoster)));
  };
  const createMatch = (setup: MatchSetup) => {
    if (!selectedSeason || selectedSeason.starters.length !== 6 || !setup.liberoIds.length || team.level === 'grade' && !team.grade) return;
    const startingLineup = selectedSeason.starters.map((id) => roster.find((athlete) => athlete.id === id)).filter((athlete): athlete is Athlete => !!athlete && !isLibero(athlete)).map((athlete) => ({ ...athlete, positions: [...athlete.positions] }));
    const startingLiberos = setup.liberoIds.map((id) => liberoPlayers.find((athlete) => athlete.id === id)).filter((athlete): athlete is Athlete => !!athlete).map((athlete) => ({ ...athlete, positions: [...athlete.positions] }));
    if (startingLineup.length !== 6 || startingLiberos.length !== setup.liberoIds.length) return;
    if (match.current.length || match.rallies.length) setArchivedMatches((items) => [match, ...items.filter((item) => item.id !== match.id)]);
    const lineup = startingLineup.map((athlete) => athlete.id);
    const nextMatch: Match = { id: makeId('match'), team: team.schoolName, opponent: setup.opponent, seasonId: selectedSeason.id, seasonName: selectedSeason.name, numberOfSets: setup.numberOfSets, scoringType: setup.scoringType, pointsToWin: setup.pointsToWin, startingLineup, liberos: startingLiberos, shareToken: makeShareToken(), set: 1, score: { home: 0, away: 0 }, serving: 'home', serverId: lineup[0] ?? null, lineup, visualLineup: lineup, current: [], rallies: [] };
    setShareOrigin(window.location.origin);
    setShareSyncStatus({ matchId: nextMatch.id, status: 'pending' });
    setMatch(nextMatch);
    setShareDialogOpen(true);
    setNewMatchOpen(false);
    setView('match');
  };
  const openArchivedMatch = (archivedMatch: Match) => {
    if (match.id !== archivedMatch.id && (match.current.length || match.rallies.length)) {
      setArchivedMatches((items) => [match, ...items.filter((item) => item.id !== match.id && item.id !== archivedMatch.id)]);
    }
    setMatch(archivedMatch);
    setSelectedSeasonId(archivedMatch.seasonId);
    setMatchesOpen(false);
  };

  return <main className="min-h-screen bg-slate-950 p-3 text-slate-50 sm:p-4"><div className="mx-auto max-w-7xl space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
      <div>
        <span className="mr-2 text-[10px] font-bold uppercase tracking-[.18em] text-sky-400">GamePath</span>
        <strong>SET {match.set} | {match.score.home}-{match.score.away} | LIVE</strong>
        <p className="text-xs text-slate-400">{team.district && `${team.district} · `}{team.schoolName} ({team.level === 'grade' ? team.grade : team.level.toUpperCase()}) vs {match.opponent} · {match.seasonName} · {match.numberOfSets} sets · {match.scoringType === 'rally' ? 'Rally' : 'Side-out'} to {match.pointsToWin}</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className="hidden text-slate-400 md:inline">{match.team} vs {match.opponent}</span>
        <select aria-label="Serving team" value={match.serving} onChange={(event) => setMatch((current) => ({ ...current, serving: event.target.value as TeamSide, serverId: event.target.value === 'home' ? current.serverId ?? current.lineup[0] : null, current: [] }))} className="rounded border border-slate-600 bg-slate-950 px-2 py-1">
          <option value="home">OUR SERVE{match.serverId ? ` • #${jerseyFor(match.serverId)}` : ''}</option>
          <option value="away">THEIR SERVE</option>
        </select>
        <button onClick={() => setHistoryOpen(true)} className="rounded border border-violet-600 px-2 py-1 text-violet-200">HISTORY</button>
        <button onClick={() => setMatchesOpen(true)} className="rounded border border-amber-600 px-2 py-1 text-amber-200">GAMES</button>
        <button onClick={() => setStatsOpen(true)} className="rounded border border-emerald-600 px-2 py-1 text-emerald-200">STATS</button>
        {match.shareToken && <button onClick={() => { setShareOrigin(window.location.origin); setShareDialogOpen(true); }} className="rounded border border-emerald-600 px-2 py-1 text-emerald-200">SHARE</button>}
        <button onClick={() => setNewMatchOpen(true)} className="rounded border border-sky-600 px-2 py-1 text-sky-200">NEW GAME</button>
        <button onClick={() => setView(view === 'match' ? 'roster' : 'match')} className="rounded border border-sky-600 px-2 py-1 text-sky-200">{view === 'match' ? 'TEAM / ROSTER' : 'MATCH'}</button>
      </div>
    </header>
    {view === 'roster' ? <TeamSetup team={team} onTeamChange={setTeam} coaches={coaches} onCoachesChange={setCoaches} seasons={seasons} selectedSeasonId={selectedSeasonId} onSelectedSeasonChange={setSelectedSeasonId} onAddSeason={addSeason} roster={roster} onRosterChange={updateRoster} onToggleStarter={toggleStarter} /> : <>
      <section className="flex items-center gap-2 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs"><strong className="shrink-0 uppercase tracking-[.15em] text-slate-400">Current</strong><span className="whitespace-nowrap">{liveNotation}</span><span className="ml-auto shrink-0 text-sky-300">NEXT: {guidance}</span></section>
      <section className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,.9fr)] gap-2 sm:gap-3"><div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900 p-2 sm:p-3">
        <div className="mb-2 flex justify-between text-xs"><strong>Court</strong><div className="flex gap-1"><select aria-label="Player layout" value={courtDisplay} onChange={(e) => setCourtDisplay(e.target.value as 'static' | 'rotate')} className="border border-slate-700 bg-slate-950"><option value="static">STATIC</option><option value="rotate">ROTATE</option></select><select aria-label="Net location" value={courtOrientation} onChange={(e) => setCourtOrientation(e.target.value as CourtOrientation)} className="border border-slate-700 bg-slate-950"><option value="bottom">NET: BOTTOM</option><option value="top">NET: TOP</option><option value="left">NET: LEFT</option><option value="right">NET: RIGHT</option></select></div></div>
        <div className={`relative grid min-h-0 flex-1 ${courtIsVertical ? 'grid-cols-2 grid-rows-3' : 'grid-cols-3 grid-rows-2'} gap-2 rounded-lg border border-slate-700 bg-slate-950 p-2`}>
          {court.map(({ athlete, position }) => <button key={athlete.id} onClick={() => tapPlayer(athlete.id)} className={`h-full w-full min-h-11 rounded-full border text-sm font-bold sm:text-xl ${athlete.id === match.serverId && match.serving === 'home' ? 'border-emerald-400 bg-emerald-500/15' : blockers.includes(athlete.id) ? 'border-sky-400 bg-sky-500/15' : 'border-slate-600 bg-slate-900'}`}>
            #{athlete.jersey}<small className="block text-[8px] font-normal text-slate-400">{position}{athlete.libero ? ' L' : ''}</small></button>)}<span aria-hidden="true" className={`${netLineClass} pointer-events-none bg-emerald-400`} /></div>
      </div><div className="rounded-xl border border-slate-800 bg-slate-900 p-2 sm:p-3"><h2 className="mb-2 text-xs font-semibold">Action / Result</h2><div className="grid grid-cols-2 gap-1.5 text-[11px] sm:text-sm"><button onClick={() => action('serve')} className="button">SERVE</button><button onClick={() => action('ace')} className="button green">ACE</button><button onClick={() => action('receive')} className="button col-span-2">RECEIVE</button><button onClick={() => action('dig')} className="button">DIG</button><button onClick={() => action('pass')} className="button">PASS</button><button onClick={() => action('set')} className="button col-span-2">SET</button><button onClick={() => action('attack_attempt')} className="button">ATTACK</button><button onClick={() => action('kill')} className="button green">KILL</button><button onClick={() => action('dug')} className="button col-span-2 amber">DUG</button><button onClick={() => action('block')} className="button col-span-2 amber">{override === 'block' ? `BLOCK: ${blockers.length} SELECTED` : 'BLOCK'}</button><button onClick={() => override === 'block' ? action('confirm-block') : action('error')} className="button col-span-2 red">ERROR</button><button onClick={() => action('blocked')} className="button col-span-2 amber">BLOCKED</button></div></div></section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-2 sm:p-3"><div className="mb-2 flex items-center justify-between"><strong className="text-xs uppercase tracking-[.15em] text-slate-400">Rally tools</strong><div className="flex gap-1 overflow-x-auto">{bench.map((a) => <button key={a.id} aria-label={`Select #${a.jersey} to sub in`} aria-pressed={subIn === a.id} onClick={() => { setSubIn(a.id); setSelectingSubOut(false); }} className={`rounded border px-2 py-1 text-xs ${subIn === a.id ? 'border-emerald-400 bg-emerald-500/15 text-emerald-200' : 'border-slate-700'}`}>#{a.jersey}</button>)}</div></div><div className="grid grid-cols-3 gap-1.5 text-[10px] sm:grid-cols-5 sm:text-xs"><button onClick={() => action('point-for')} className="tool">POINT FOR</button><button onClick={() => action('point-against')} className="tool">POINT AGAINST</button><button onClick={() => action('joust')} className="tool">JOUST</button><button onClick={() => subIn && setSelectingSubOut((active) => !active)} disabled={!subIn} aria-label={selectingSubOut ? 'Cancel substitution' : subIn ? `Sub in #${jerseyFor(subIn)}` : 'Select a bench player first'} className={`tool ${selectingSubOut ? 'amber' : ''}`}>
  {selectingSubOut ? 'PICK PLAYER OUT' : subIn ? `SUB #${jerseyFor(subIn)}` : 'SUB'}
</button><button className="tool">LIBERO</button><button onClick={() => setHistoryOpen(true)} className="tool">CHALLENGE</button><button onClick={() => setMatch((m) => ({ ...m, current: m.current.slice(0, -1) }))} className="tool">UNDO</button><button onClick={() => setHistoryOpen(true)} className="tool">FLAG</button><button onClick={() => { if (confirm('End match now?')) alert('Match marked complete.'); }} className="tool red">END MATCH</button></div></section>
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-2 sm:p-3"><div className="mb-2 flex justify-between"><strong className="text-xs uppercase tracking-[.15em] text-slate-400">Recent rallies</strong><button onClick={() => setHistoryOpen(true)} className="text-xs text-violet-300">VIEW ALL</button></div><div className="max-h-32 space-y-1 overflow-y-auto">{[...match.rallies].reverse().slice(0, 5).map((r) => <button key={r.id} onClick={() => setHistoryOpen(true)} className="block w-full truncate rounded border border-slate-800 bg-slate-950 px-2 py-1 text-left text-xs">R{r.number} {r.scoreAfter.home}-{r.scoreAfter.away} {compact(r.events, jerseyFor)}</button>)}</div></section>
    </>}
    {historyOpen && <Drawer title="Rally History" close={() => setHistoryOpen(false)}>{[...match.rallies].reverse().map((r) => <div key={r.id} className="mb-2 rounded border border-slate-800 bg-slate-900 p-3 text-sm"><strong>R{r.number} • {r.scoreBefore.home}-{r.scoreBefore.away} → {r.scoreAfter.home}-{r.scoreAfter.away}</strong><p className="mt-1 text-slate-300">{compact(r.events, jerseyFor)}</p><button onClick={() => setMatch((m) => ({ ...m, rallies: m.rallies.map((x) => x.id === r.id ? { ...x, flagged: !x.flagged } : x) }))} className="mt-2 rounded border border-amber-600 px-2 py-1 text-xs">{r.flagged ? 'UNFLAG' : 'FLAG'}</button></div>)}</Drawer>}
    {statsOpen && <Drawer title="Match Stats" close={() => setStatsOpen(false)}>{roster.map((a) => { const stats = calculatePlayerStats(match.rallies.flatMap((r) => r.events.map((event) => ({ ...event, athleteId: event.athleteId ?? undefined }))), a.id); return <div key={a.id} className="mb-2 rounded border border-slate-800 p-2 text-sm">#{a.jersey} {a.firstName} {a.lastName}<span className="float-right text-slate-400">K {stats.kills} • A {stats.assists} • D {stats.digs}</span></div>; })}</Drawer>}
    {matchesOpen && <Drawer title="Games" close={() => setMatchesOpen(false)}><div className="space-y-2"><button className="block w-full rounded border border-sky-700 bg-slate-900 p-3 text-left text-sm" onClick={() => setMatchesOpen(false)}><strong>{match.team} vs {match.opponent}</strong><p className="mt-1 text-xs text-slate-400">{match.seasonName} · {match.numberOfSets} sets · {match.scoringType} to {match.pointsToWin} · Current game</p><p className="mt-1 text-xs text-slate-400">Court starters: {match.startingLineup.map((athlete) => `#${athlete.jersey} ${athlete.firstName} ${athlete.lastName}`).join(', ') || 'No lineup snapshot'}</p><p className="mt-1 text-xs text-slate-400">Libero(s): {match.liberos.map((athlete) => `#${athlete.jersey} ${athlete.firstName} ${athlete.lastName}`).join(', ') || 'None recorded'}</p></button>{archivedMatches.map((archivedMatch) => <button key={archivedMatch.id} className="block w-full rounded border border-slate-800 bg-slate-900 p-3 text-left text-sm" onClick={() => openArchivedMatch(archivedMatch)}><strong>{archivedMatch.team} vs {archivedMatch.opponent}</strong><p className="mt-1 text-xs text-slate-400">{archivedMatch.seasonName} · {archivedMatch.numberOfSets} sets · {archivedMatch.scoringType} to {archivedMatch.pointsToWin} · {archivedMatch.score.home}-{archivedMatch.score.away}</p><p className="mt-1 text-xs text-slate-400">Court starters: {archivedMatch.startingLineup.map((athlete) => `#${athlete.jersey} ${athlete.firstName} ${athlete.lastName}`).join(', ') || 'No lineup snapshot'}</p><p className="mt-1 text-xs text-slate-400">Libero(s): {archivedMatch.liberos.map((athlete) => `#${athlete.jersey} ${athlete.firstName} ${athlete.lastName}`).join(', ') || 'None recorded'}</p></button>)}</div></Drawer>}
    <NewMatchDialog key={liberoPlayers.map((athlete) => `${athlete.id}:${athlete.positions.join(',')}`).join('|')} open={newMatchOpen} seasonName={selectedSeason?.name ?? ''} starterCount={selectedSeason?.starters.length ?? 0} liberos={liberoPlayers} canCreate={team.level !== 'grade' || !!team.grade} onClose={() => setNewMatchOpen(false)} onCreate={createMatch} />
    {match.shareToken && <MatchShareDialog key={match.id} open={shareDialogOpen} matchId={match.id} token={match.shareToken} defaultOrigin={shareOrigin} syncStatus={shareSyncStatus?.matchId === match.id ? shareSyncStatus.status : 'pending'} onClose={() => setShareDialogOpen(false)} />}
  </div><style jsx>{`.button,.tool{border:1px solid #475569;background:#020617;border-radius:6px;padding:.45rem;color:#e2e8f0;min-height:32px}.green{border-color:#10b981;background:#064e3b33}.amber{border-color:#f59e0b;background:#78350f22}.red{border-color:#ef4444;background:#7f1d1d33}`}</style></main>;
}
function Drawer({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-50 flex justify-end bg-black/60"><aside className="h-full w-full max-w-xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-4"><div className="mb-4 flex justify-between"><h2 className="text-lg font-semibold">{title}</h2><button onClick={close} className="rounded border border-slate-700 px-2 py-1 text-sm">Close</button></div>{children}</aside></div>; }
