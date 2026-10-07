'use client';

import { useState, type FormEvent } from 'react';
import { CAMERA_POSITIONS, camerasForCount, cameraWithPosition, type CameraPosition, type MatchCamera } from '@/lib/cameras';
import type { Athlete, MatchSetup, ScoringType } from '@/lib/team-data';

type NewMatchDialogProps = {
  open: boolean;
  seasonName: string;
  starterCount: number;
  liberos: Athlete[];
  canCreate: boolean;
  onClose: () => void;
  onCreate: (setup: MatchSetup) => void;
};

const inputClass = 'rounded border border-slate-700 bg-slate-950 p-2 text-sm';

export default function NewMatchDialog({ open, seasonName, starterCount, liberos, canCreate, onClose, onCreate }: NewMatchDialogProps) {
  const [opponent, setOpponent] = useState('');
  const [numberOfSets, setNumberOfSets] = useState(5);
  const [scoringType, setScoringType] = useState<ScoringType>('rally');
  const [pointsToWin, setPointsToWin] = useState(25);
  const [liberoIds, setLiberoIds] = useState(() => liberos.map((athlete) => athlete.id));
  const [cameraIds] = useState(() => ['camera-1', 'camera-2', 'camera-3', 'camera-4'].map((suffix) => `${suffix}-${Math.random().toString(36).slice(2, 9)}`));
  const [cameras, setCameras] = useState<MatchCamera[]>(() => camerasForCount(1, [], cameraIds));

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = opponent.trim();
    if (!name || starterCount !== 6 || !liberoIds.length || numberOfSets < 1 || pointsToWin < 1) return;
    onCreate({ opponent: name, numberOfSets, scoringType, pointsToWin, liberoIds, cameras });
    setOpponent('');
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="new-match-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <div className="mb-4 flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-sky-300">{seasonName || 'No season selected'}</p><h2 id="new-match-title" className="text-lg font-semibold">New game</h2></div><button type="button" onClick={onClose} aria-label="Close new game" className="rounded border border-slate-700 px-2 py-1 text-sm">CLOSE</button></div>
      <form className="space-y-4" onSubmit={submit}>
        <label className="grid gap-1 text-xs text-slate-400">Opponent name<input className={inputClass} required autoFocus value={opponent} onChange={(event) => setOpponent(event.target.value)} /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs text-slate-400">Number of sets<input className={inputClass} type="number" min="1" max="9" required value={numberOfSets} onChange={(event) => setNumberOfSets(Number(event.target.value))} /></label>
          <label className="grid gap-1 text-xs text-slate-400">Points required to win<input className={inputClass} type="number" min="1" required value={pointsToWin} onChange={(event) => setPointsToWin(Number(event.target.value))} /></label>
        </div>
        <fieldset className="space-y-2"><legend className="mb-2 text-xs text-slate-400">Scoring type</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="scoringType" value="rally" checked={scoringType === 'rally'} onChange={() => setScoringType('rally')} />Rally scoring</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="scoringType" value="side-out" checked={scoringType === 'side-out'} onChange={() => setScoringType('side-out')} />Side-out scoring</label>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs text-slate-400">Cameras</legend>
          <label className="grid gap-1 text-xs text-slate-400">Number of cameras
            <input className={inputClass} type="number" min="1" max="4" required value={cameras.length} onChange={(event) => setCameras((current) => camerasForCount(Number(event.target.value), current, cameraIds))} />
          </label>
          {cameras.map((camera, index) => <label key={camera.id} className="grid gap-1 text-xs text-slate-400">Camera {index + 1} position
            <select className={inputClass} aria-label={`Camera ${index + 1} position`} value={camera.position} onChange={(event) => setCameras((current) => cameraWithPosition(current, index, event.target.value as CameraPosition))}>
              {CAMERA_POSITIONS.map(([position, label]) => <option key={position} value={position}>{label}</option>)}
            </select>
          </label>)}
          <p className="text-xs text-slate-500">Left and right are as you stand on the near end line looking across the court. Each camera gets its own setup link.</p>
        </fieldset>
        <fieldset className="space-y-2"><legend className="mb-2 text-xs text-slate-400">Libero(s) for this game · select all that apply</legend>
          {liberos.length ? liberos.map((athlete) => <label key={athlete.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={liberoIds.includes(athlete.id)} onChange={() => setLiberoIds((current) => current.includes(athlete.id) ? current.filter((id) => id !== athlete.id) : [...current, athlete.id])} />#{athlete.jersey} {athlete.firstName} {athlete.lastName}</label>) : <p className="text-sm text-amber-300">Mark at least one roster player as Libero before creating a game.</p>}
          {!liberoIds.length && liberos.length > 0 && <p className="text-sm text-amber-300">Select at least one libero for this game.</p>}
        </fieldset>
        {starterCount !== 6 && <p className="text-sm text-amber-300">Select six starters for {seasonName || 'the active season'} in Team / Roster before creating a game. ({starterCount} selected)</p>}
        {!canCreate && <p className="text-sm text-amber-300">Complete the required team grade before creating a game.</p>}
        <div className="flex justify-end"><button type="submit" disabled={starterCount !== 6 || !canCreate || !liberoIds.length || !liberos.length} className="rounded bg-sky-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40">CREATE GAME</button></div>
      </form>
    </section>
  </div>;
}
