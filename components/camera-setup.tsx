'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CAMERA_POSITIONS, MATCH_STORAGE_KEY, PICTURE_EDGES, cameraPositionLabel, readStoredCamera, writeStoredCamera, type CameraPosition, type MatchCamera, type PictureEdge } from '@/lib/cameras';
import { loadDevice } from '@/lib/device';
import { liveCameraEndpoint, liveMatchEndpoint } from '@/lib/live-report';

export default function CameraSetup() {
  const params = useSearchParams();
  const matchId = params.get('match') ?? '';
  const cameraId = params.get('camera') ?? '';
  const token = params.get('token') ?? '';
  const [camera, setCamera] = useState<MatchCamera | null>(null);
  const [heading, setHeading] = useState('');
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState('Loading this camera.');

  useEffect(() => {
    let active = true;
    const loadLocal = () => {
      const raw = localStorage.getItem(MATCH_STORAGE_KEY);
      const found = raw && matchId && cameraId ? readStoredCamera(raw, matchId, cameraId) : null;
      if (!found) {
        setMissing(true);
        setStatus('This camera is not on this computer.');
        return;
      }
      setCamera(found.camera);
      setHeading(`${found.team} vs ${found.opponent}`);
      setStatus(`${cameraPositionLabel(found.camera.position)}. Near end of the picture is at the ${found.camera.pictureEdge}.`);
    };
    if (!token) {
      loadLocal();
      return;
    }
    void fetch(liveMatchEndpoint(matchId, token), { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json() as { match?: { team?: string; opponent?: string; cameras?: MatchCamera[] } };
        if (!active) return;
        const found = body.match?.cameras?.find((item) => item.id === cameraId);
        if (!response.ok || !found) {
          loadLocal();
          return;
        }
        setMissing(false);
        setCamera(found);
        setHeading(`${body.match?.team ?? 'Home'} vs ${body.match?.opponent ?? 'Opponent'}`);
        setStatus(`${cameraPositionLabel(found.position)}. Near end of the picture is at the ${found.pictureEdge}.`);
      })
      .catch(() => { if (active) loadLocal(); });
    return () => { active = false; };
  }, [matchId, cameraId, token]);

  const save = (next: MatchCamera) => {
    if (token) {
      const device = loadDevice();
      void fetch(liveCameraEndpoint(matchId, next.id, token), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceId: device?.id, position: next.position, pictureEdge: next.pictureEdge }),
      }).then(async (response) => {
        const body = await response.json().catch(() => ({})) as { message?: string };
        if (!response.ok) {
          setStatus(body.message || 'Could not save this camera on the host.');
          return;
        }
        setCamera(next);
        setStatus('Saved on the host for every stat keeper and coach.');
      }).catch(() => setStatus('Could not reach the host.'));
      return;
    }
    const raw = localStorage.getItem(MATCH_STORAGE_KEY);
    const saved = raw ? writeStoredCamera(raw, matchId, next) : null;
    if (!saved) {
      setStatus('This camera is not on this computer.');
      return;
    }
    localStorage.setItem(MATCH_STORAGE_KEY, saved);
    setCamera(next);
    setStatus('Saved on this computer.');
  };

  return <main className="min-h-screen bg-slate-950 p-4 text-slate-50">
    <section className="mx-auto max-w-lg space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-sky-300">One camera</p>
        <h1 className="text-lg font-semibold">{camera ? `Camera at the ${cameraPositionLabel(camera.position).toLowerCase()}` : 'Camera setup'}</h1>
        <p className="text-sm text-slate-400">{heading || 'GamePath'}</p>
      </div>
      {missing || !camera ? <p className="text-sm text-amber-300">{status} Create the game in GamePath on the host, then open this camera from the join link.</p> : <>
        <label className="grid gap-1 text-xs text-slate-400">Where this camera sits
          <select className="rounded border border-slate-700 bg-slate-950 p-2 text-sm" value={camera.position} onChange={(event) => save({ ...camera, position: event.target.value as CameraPosition })}>
            {CAMERA_POSITIONS.map(([position, label]) => <option key={position} value={position}>{label}</option>)}
          </select>
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs text-slate-400">Near end of the court is at the</legend>
          {PICTURE_EDGES.map(([edge, label]) => <label key={edge} className="flex items-center gap-2 text-sm">
            <input type="radio" name="pictureEdge" value={edge} checked={camera.pictureEdge === edge} onChange={() => save({ ...camera, pictureEdge: edge as PictureEdge })} />
            {label} of the picture
          </label>)}
        </fieldset>
        <p className="text-sm text-slate-300" role="status">{status}</p>
        <p className="text-xs text-slate-500">This phone is registered as a camera. Stat keepers and coaches read this setup from the host.</p>
        {token && <a className="inline-block text-xs text-sky-300" href={`/?join=${encodeURIComponent(token)}&match=${encodeURIComponent(matchId)}&change=1`}>Change mode</a>}
      </>}
    </section>
  </main>;
}
