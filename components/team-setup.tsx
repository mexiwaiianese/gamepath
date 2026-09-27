'use client';

import { useState, type FormEvent } from 'react';
import type { Athlete, Coach, Season, TeamProfile } from '@/lib/team-data';
import { isLibero, positionOptions } from '@/lib/team-data';

type TeamSetupProps = {
  team: TeamProfile;
  onTeamChange: (team: TeamProfile) => void;
  coaches: Coach[];
  onCoachesChange: (coaches: Coach[]) => void;
  seasons: Season[];
  selectedSeasonId: string;
  onSelectedSeasonChange: (id: string) => void;
  onAddSeason: (name: string) => void;
  roster: Athlete[];
  onRosterChange: (roster: Athlete[]) => void;
  onToggleStarter: (athleteId: string) => void;
};

const inputClass = 'min-w-0 rounded border border-slate-700 bg-slate-950 p-2 text-sm';
const sectionClass = 'space-y-3 border-b border-slate-800 py-4 last:border-b-0';

export default function TeamSetup({
  team,
  onTeamChange,
  coaches,
  onCoachesChange,
  seasons,
  selectedSeasonId,
  onSelectedSeasonChange,
  onAddSeason,
  roster,
  onRosterChange,
  onToggleStarter,
}: TeamSetupProps) {
  const [seasonName, setSeasonName] = useState('');
  const [playerForm, setPlayerForm] = useState({ jersey: '', firstName: '', lastName: '', positions: [] as string[] });
  const [coachForm, setCoachForm] = useState({ firstName: '', lastName: '', phone: '' });
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId);

  const addSeason = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = seasonName.trim();
    if (!name || seasons.some((season) => season.name.toLowerCase() === name.toLowerCase())) return;
    onAddSeason(name);
    setSeasonName('');
  };

  const addPlayer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!playerForm.jersey || !playerForm.firstName.trim() || !playerForm.lastName.trim() || !playerForm.positions.length) return;
    if (roster.some((athlete) => athlete.jersey === Number(playerForm.jersey))) return;
    onRosterChange([...roster, {
      id: `athlete-${Math.random().toString(36).slice(2, 9)}`,
      jersey: Number(playerForm.jersey),
      firstName: playerForm.firstName.trim(),
      lastName: playerForm.lastName.trim(),
      positions: playerForm.positions,
      libero: playerForm.positions.includes('Libero'),
    }]);
    setPlayerForm({ jersey: '', firstName: '', lastName: '', positions: [] });
  };

  const addCoach = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!coachForm.firstName.trim() || !coachForm.lastName.trim() || !coachForm.phone.trim()) return;
    onCoachesChange([...coaches, { id: `coach-${Math.random().toString(36).slice(2, 9)}`, ...coachForm, firstName: coachForm.firstName.trim(), lastName: coachForm.lastName.trim(), phone: coachForm.phone.trim() }]);
    setCoachForm({ firstName: '', lastName: '', phone: '' });
  };

  const updateAthlete = (id: string, update: Partial<Athlete>) => {
    onRosterChange(roster.map((athlete) => athlete.id === id ? { ...athlete, ...update, libero: update.positions?.includes('Libero') ?? athlete.libero } : athlete));
  };

  const togglePosition = (positions: string[], position: string) => positions.includes(position)
    ? positions.filter((item) => item !== position)
    : [...positions, position];

  return <div className="rounded-lg border border-slate-800 bg-slate-900 px-4">
    <section className={sectionClass}>
      <h1 className="text-lg font-semibold">Team</h1>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-slate-400">District<input className={inputClass} value={team.district} onChange={(event) => onTeamChange({ ...team, district: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">School name<input className={inputClass} value={team.schoolName} onChange={(event) => onTeamChange({ ...team, schoolName: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Team level<select className={inputClass} value={team.level} onChange={(event) => onTeamChange({ ...team, level: event.target.value as TeamProfile['level'], grade: event.target.value === 'grade' ? team.grade : '' })}><option value="grade">Grade level</option><option value="freshman">Freshman</option><option value="jv">JV</option><option value="varsity">Varsity</option></select></label>
        {team.level === 'grade' && <label className="grid gap-1 text-xs text-slate-400">Grade (required)<select required className={inputClass} value={team.grade} onChange={(event) => onTeamChange({ ...team, grade: event.target.value })}><option value="">Select grade</option>{['Kindergarten', ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`)].map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>}
      </div>
    </section>

    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Seasons</h2>
      <div className="flex flex-wrap items-center gap-2">
        <label className="grid gap-1 text-xs text-slate-400">Active season<select className={inputClass} value={selectedSeasonId} onChange={(event) => onSelectedSeasonChange(event.target.value)}>{seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}</select></label>
        <form className="flex min-w-0 flex-1 items-end gap-2" onSubmit={addSeason}>
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-slate-400">New season<input className={inputClass} placeholder="e.g. 2027 Fall" value={seasonName} onChange={(event) => setSeasonName(event.target.value)} /></label>
          <button className="rounded border border-sky-600 px-3 py-2 text-xs text-sky-200" type="submit">ADD SEASON</button>
        </form>
      </div>
    </section>

    <section className={sectionClass}>
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">Starting lineup</h2><span className="text-xs text-slate-400">{selectedSeason?.starters.length ?? 0} of 6 selected for {selectedSeason?.name ?? 'this season'}</span></div>
      <div className="grid gap-1 sm:grid-cols-2">{roster.filter((athlete) => !isLibero(athlete)).map((athlete) => {
        const selected = selectedSeason?.starters.includes(athlete.id) ?? false;
        const disabled = !selected && (selectedSeason?.starters.length ?? 0) >= 6;
        return <label key={athlete.id} className={`flex min-w-0 items-center gap-2 rounded border px-2 py-2 text-sm ${selected ? 'border-emerald-700 bg-emerald-950/30' : 'border-slate-800 bg-slate-950'}`}>
          <input type="checkbox" checked={selected} disabled={disabled || !selectedSeason} onChange={() => onToggleStarter(athlete.id)} />
          <span className="truncate">#{athlete.jersey} {athlete.firstName} {athlete.lastName}</span>
          <span className="ml-auto truncate text-xs text-slate-400">{athlete.positions.join(', ')}</span>
        </label>;
      })}</div>
      <p className="text-xs text-slate-500">Liberos are selected separately for each game. The six starters and per-game liberos are snapshotted when a game is created.</p>
    </section>

    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Players</h2>
      <form className="grid gap-2 sm:grid-cols-4" onSubmit={addPlayer}>
        <label className="grid gap-1 text-xs text-slate-400">Number<input aria-label="Player number" className={inputClass} type="number" min="0" max="99" required value={playerForm.jersey} onChange={(event) => setPlayerForm({ ...playerForm, jersey: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">First name<input className={inputClass} required value={playerForm.firstName} onChange={(event) => setPlayerForm({ ...playerForm, firstName: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Last name<input className={inputClass} required value={playerForm.lastName} onChange={(event) => setPlayerForm({ ...playerForm, lastName: event.target.value })} /></label>
        <button className="self-end rounded bg-sky-600 px-3 py-2 text-sm" type="submit">ADD PLAYER</button>
        <fieldset className="grid gap-2 sm:col-span-4">
          <legend className="mb-1 text-xs text-slate-400">Position(s), select all that apply</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">{positionOptions.map((position) => <label key={position} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={playerForm.positions.includes(position)} onChange={() => setPlayerForm({ ...playerForm, positions: togglePosition(playerForm.positions, position) })} />{position}</label>)}</div>
        </fieldset>
      </form>
      <div className="mt-3 space-y-1">{roster.map((athlete) => <details key={athlete.id} className="rounded border border-slate-800 bg-slate-950 px-2 py-2 text-sm">
        <summary className="cursor-pointer">#{athlete.jersey} {athlete.firstName} {athlete.lastName}<span className="float-right text-slate-400">{athlete.positions.join(', ') || 'No position'}</span></summary>
        <div className="grid gap-2 py-3 sm:grid-cols-3">
          <label className="grid gap-1 text-xs text-slate-400">Number<input className={inputClass} type="number" min="0" max="99" value={athlete.jersey} onChange={(event) => updateAthlete(athlete.id, { jersey: Number(event.target.value) })} /></label>
          <label className="grid gap-1 text-xs text-slate-400">First name<input className={inputClass} value={athlete.firstName} onChange={(event) => updateAthlete(athlete.id, { firstName: event.target.value })} /></label>
          <label className="grid gap-1 text-xs text-slate-400">Last name<input className={inputClass} value={athlete.lastName} onChange={(event) => updateAthlete(athlete.id, { lastName: event.target.value })} /></label>
          <fieldset className="sm:col-span-3"><legend className="mb-1 text-xs text-slate-400">Position(s)</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{positionOptions.map((position) => <label key={position} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={athlete.positions.includes(position)} onChange={() => updateAthlete(athlete.id, { positions: togglePosition(athlete.positions, position) })} />{position}</label>)}</div></fieldset>
          <button className="justify-self-start text-xs text-red-300" type="button" onClick={() => onRosterChange(roster.filter((item) => item.id !== athlete.id))}>REMOVE PLAYER</button>
        </div>
      </details>)}</div>
    </section>

    <section className={sectionClass}>
      <h2 className="text-sm font-semibold">Coaches</h2>
      <form className="grid gap-2 sm:grid-cols-4" onSubmit={addCoach}>
        <label className="grid gap-1 text-xs text-slate-400">First name<input className={inputClass} required value={coachForm.firstName} onChange={(event) => setCoachForm({ ...coachForm, firstName: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Last name<input className={inputClass} required value={coachForm.lastName} onChange={(event) => setCoachForm({ ...coachForm, lastName: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Contact phone<input className={inputClass} type="tel" required value={coachForm.phone} onChange={(event) => setCoachForm({ ...coachForm, phone: event.target.value })} /></label>
        <button className="self-end rounded bg-sky-600 px-3 py-2 text-sm" type="submit">ADD COACH</button>
      </form>
      <div className="mt-3 space-y-1">{coaches.map((coach) => <div key={coach.id} className="grid items-center gap-2 rounded border border-slate-800 bg-slate-950 p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="grid gap-1 text-xs text-slate-400">First name<input className={inputClass} value={coach.firstName} onChange={(event) => onCoachesChange(coaches.map((item) => item.id === coach.id ? { ...item, firstName: event.target.value } : item))} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Last name<input className={inputClass} value={coach.lastName} onChange={(event) => onCoachesChange(coaches.map((item) => item.id === coach.id ? { ...item, lastName: event.target.value } : item))} /></label>
        <label className="grid gap-1 text-xs text-slate-400">Contact phone<input className={inputClass} type="tel" value={coach.phone} onChange={(event) => onCoachesChange(coaches.map((item) => item.id === coach.id ? { ...item, phone: event.target.value } : item))} /></label>
        <button className="justify-self-start text-xs text-red-300" type="button" onClick={() => onCoachesChange(coaches.filter((item) => item.id !== coach.id))}>REMOVE</button>
      </div>)}</div>
    </section>
  </div>;
}
