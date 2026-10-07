'use client';

import { useState } from 'react';
import { cameraPositionLabel, type MatchCamera } from '@/lib/cameras';
import { liveMatchEndpoint } from '@/lib/live-report';
import type { DeviceRole } from '@/lib/device';

type DeviceJoinProps = {
  matchId: string;
  token: string;
  onChoose: (role: DeviceRole, cameraId?: string) => void;
  onClose?: () => void;
};

export default function DeviceJoin({ matchId, token, onChoose, onClose }: DeviceJoinProps) {
  const [cameras, setCameras] = useState<MatchCamera[] | null>(null);
  const [message, setMessage] = useState('');

  const chooseCamera = async () => {
    setMessage('');
    try {
      const response = await fetch(liveMatchEndpoint(matchId, token), { cache: 'no-store' });
      const body = await response.json() as { match?: { cameras?: MatchCamera[] }; message?: string };
      if (!response.ok || !body.match) {
        setMessage(body.message || 'The match is not on the host yet. Keep the scorer online and try again.');
        return;
      }
      const list = body.match.cameras ?? [];
      if (list.length <= 1 && list[0]) {
        onChoose('camera', list[0].id);
        return;
      }
      setCameras(list);
    } catch {
      setMessage('Could not reach the host. Stay on the team network and try again.');
    }
  };

  return <main className="min-h-screen bg-slate-950 p-4 text-slate-50">
    <section className="mx-auto max-w-lg space-y-3 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-sky-300">Team network</p>
          <h1 className="text-lg font-semibold">{cameras ? 'Which camera is this phone?' : 'How will this device be used?'}</h1>
        </div>
        {onClose && <button type="button" onClick={onClose} className="rounded border border-slate-700 px-2 py-1 text-sm">CLOSE</button>}
      </div>
      {cameras ? <div className="grid gap-2">
        {cameras.map((camera, index) => <button key={camera.id} type="button" onClick={() => onChoose('camera', camera.id)} className="rounded border border-slate-700 px-3 py-3 text-left text-sm">Camera {index + 1}: {cameraPositionLabel(camera.position)}</button>)}
      </div> : <div className="grid gap-2">
        <button type="button" onClick={() => onChoose('stat')} className="rounded border border-sky-600 px-3 py-3 text-left"><strong className="block">Stat keeping</strong><span className="text-xs text-slate-400">Record rallies into the same match as the other stat keepers.</span></button>
        <button type="button" onClick={() => onChoose('coach')} className="rounded border border-emerald-600 px-3 py-3 text-left"><strong className="block">Coach</strong><span className="text-xs text-slate-400">Live score, rallies, and player stats. No stat entry.</span></button>
        <button type="button" onClick={() => void chooseCamera()} className="rounded border border-slate-600 px-3 py-3 text-left"><strong className="block">Camera</strong><span className="text-xs text-slate-400">Register this phone as a court camera, then set its angle.</span></button>
      </div>}
      {message && <p className="text-sm text-amber-300">{message}</p>}
    </section>
  </main>;
}
