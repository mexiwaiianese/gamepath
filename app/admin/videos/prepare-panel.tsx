'use client';

import { useRef, useState } from 'react';

import { TAGGERS, type TaggerId } from '@/lib/admin-video';
import {
  CHECK_RALLY_NUMBER,
  RALLY_COUNT_RULE,
  clockText,
  invalidationWarnings,
  parseSeconds,
  rallyClip,
  secondsText,
  stepGate,
  validateAnchors,
  validateRallies,
  type PipelineStep,
} from '@/lib/admin-video-pipeline';

import type { TaggerAction, TaggerStatus, Video } from './video-types';

type Row = { key: number; serve: string; dead: string };

type Props = {
  video: Video;
  taggers: Record<string, TaggerStatus>;
  busyTagger: string | null;
  onTagger: (id: TaggerId, action: TaggerAction, asset: string) => void;
  /** Reload the video list so the Pipeline chips reflect what the CLI just wrote. */
  onChanged: () => Promise<void>;
};

const button = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40';
const primary = `${button} bg-emerald-600 hover:bg-emerald-500`;
const neutral = `${button} bg-slate-700 hover:bg-slate-600`;
const small = 'rounded bg-slate-700 px-2 py-1 text-xs font-medium hover:bg-slate-600 disabled:opacity-40';
const input = 'rounded bg-slate-800 px-2 py-1 text-sm font-mono';

function StepHeader({ n, title, done, locked, stale }: { n: number; title: string; done: boolean; locked?: string | null; stale?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h4 className="font-semibold">{n}. {title}</h4>
      <span className={`rounded-full px-2 py-0.5 text-xs ${stale ? 'bg-amber-900 text-amber-200' : done ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
        {stale ? 'out of date' : done ? 'done' : 'not done'}
      </span>
      {locked && <span className="text-xs text-slate-500">locked: {locked}</span>}
    </div>
  );
}

function Problem({ text }: { text: string | null | undefined }) {
  return text ? <pre className="mt-2 whitespace-pre-wrap rounded bg-red-950 p-2 text-xs text-red-200" role="alert">{text}</pre> : null;
}

function Warning({ items }: { items: string[] }) {
  return items.length ? (
    <ul className="mt-2 list-disc space-y-0.5 rounded bg-amber-950 p-2 pl-6 text-xs text-amber-200">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : null;
}

export default function PreparePanel({ video, taggers, busyTagger, onTagger, onChanged }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const nextKey = useRef(1);
  const durationMs = video.probe?.duration_ms ?? 0;

  const [time, setTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(durationMs / 1000);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [first, setFirst] = useState(() => (video.timing ? secondsText(video.timing.first_serve_ms / 1000) : ''));
  const [end, setEnd] = useState(() => (video.timing ? secondsText(video.timing.set_end_ms / 1000) : ''));
  const [speed, setSpeed] = useState(() => String(video.timing?.capture_speed ?? 1));
  const [offCamera, setOffCamera] = useState(() => (video.timing ? !video.timing.server_visible : false));

  const [rows, setRows] = useState<Row[]>(() =>
    (video.rally_index?.rallies ?? []).map((r) => ({ key: nextKey.current++, serve: secondsText(r.serve_ms / 1000), dead: secondsText(r.dead_ms / 1000) })),
  );
  const [rallyNote, setRallyNote] = useState<string | null>(null);

  const [busy, setBusy] = useState<PipelineStep | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PipelineStep, string>>>({});
  const [notes, setNotes] = useState<Partial<Record<PipelineStep, string>>>({});

  const step = (label: string) => video.readiness.steps.find((s) => s.label === label);
  const done = (label: string) => Boolean(step(label)?.done);
  const framesStale = Boolean(step('Frames')?.stale);
  const confirmed = video.rally_index?.review === 'confirmed';
  const saved = video.rally_index?.rallies ?? [];
  const idle = busy === null;

  // ----- player -----

  const now = () => videoRef.current?.currentTime ?? time;

  function seek(seconds: number) {
    const el = videoRef.current;
    if (!el) return;
    const limit = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : mediaDuration || Infinity;
    const target = Math.min(limit, Math.max(0, seconds));
    el.currentTime = target;
    setTime(target);
  }

  const nudge = (delta: number) => seek(now() + delta);

  // ----- anchors -----

  const anchorCheck = validateAnchors({ firstServe: first, setEnd: end, captureSpeed: speed, serverOffCamera: offCamera }, durationMs);
  const anchorWarnings = invalidationWarnings(video, 'anchors', { anchors: anchorCheck.value });
  const anchorsBlocked = stepGate(video, 'anchors');

  // ----- rallies -----

  const spans = rows.map((row) => ({ serve: parseSeconds(row.serve), dead: parseSeconds(row.dead) }));
  const rallyCheck = validateRallies(spans, video.timing, durationMs);
  const ralliesBlocked = stepGate(video, 'rallies');
  const savedKey = saved.map((r) => `${r.serve_ms}-${r.dead_ms}`).join(',');
  const draftKey = spans.map((s) => (s.serve === null || s.dead === null ? 'x' : `${Math.round(s.serve * 1000)}-${Math.round(s.dead * 1000)}`)).join(',');
  const rallyDirty = savedKey !== draftKey;
  const rallyWarnings = invalidationWarnings(video, 'rallies');

  function addRow(row: Omit<Row, 'key'>) {
    setRows((current) => {
      const next = [...current, { key: nextKey.current++, ...row }];
      return next.sort((a, b) => (parseSeconds(a.serve) ?? Infinity) - (parseSeconds(b.serve) ?? Infinity));
    });
  }

  function markServe() {
    setRallyNote(null);
    addRow({ serve: secondsText(now()), dead: '' });
  }

  function markDeadBall() {
    const at = now();
    const open = rows
      .filter((row) => row.dead.trim() === '' && parseSeconds(row.serve) !== null && (parseSeconds(row.serve) as number) < at)
      .sort((a, b) => (parseSeconds(b.serve) as number) - (parseSeconds(a.serve) as number))[0];
    if (!open) {
      setRallyNote('Mark a serve earlier in the video first. A dead ball needs an open rally that starts before the current time.');
      return;
    }
    setRallyNote(null);
    setRows((current) => current.map((row) => (row.key === open.key ? { ...row, dead: secondsText(at) } : row)));
  }

  const editRow = (key: number, field: 'serve' | 'dead', value: string) => setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  const deleteRow = (key: number) => setRows((current) => current.filter((row) => row.key !== key));
  const sortRows = () => setRows((current) => [...current].sort((a, b) => (parseSeconds(a.serve) ?? Infinity) - (parseSeconds(b.serve) ?? Infinity)));
  const resetRows = () => {
    setRallyNote(null);
    setRows(saved.map((r) => ({ key: nextKey.current++, serve: secondsText(r.serve_ms / 1000), dead: secondsText(r.dead_ms / 1000) })));
  };

  // ----- running a step -----

  async function runStep(which: PipelineStep, payload: Record<string, unknown>, warnings: string[]) {
    if (!idle) return;
    if (warnings.length && !window.confirm(`Saving this will change later steps:\n\n- ${warnings.join('\n- ')}\n\nContinue?`)) return;
    setBusy(which);
    setErrors((current) => ({ ...current, [which]: undefined }));
    setNotes((current) => ({ ...current, [which]: undefined }));
    try {
      const res = await fetch('/api/admin/videos/pipeline/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: video.id, step: which, ...payload }),
      });
      const text = await res.text();
      let body: { ok?: boolean; error?: string; output?: string };
      try {
        body = JSON.parse(text);
      } catch {
        body = { ok: false, error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${text.slice(0, 200) || 'non-JSON response'}` };
      }
      if (body.ok) setNotes((current) => ({ ...current, [which]: body.output || 'Saved.' }));
      else setErrors((current) => ({ ...current, [which]: body.error || 'The command failed.' }));
    } catch (error) {
      setErrors((current) => ({ ...current, [which]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(null);
      try {
        await onChanged();
      } catch {
        // The list refreshes again on its own timer.
      }
    }
  }

  const saveAnchors = () => {
    if (!anchorCheck.value) return;
    const { firstServeSec, setEndSec, captureSpeed, serverOffCamera } = anchorCheck.value;
    runStep('anchors', { firstServeSec, setEndSec, captureSpeed, serverOffCamera }, anchorWarnings);
  };
  const saveRallies = () => runStep('rallies', { rallies: spans }, rallyWarnings);
  const confirmRallies = () => runStep('confirm', {}, invalidationWarnings(video, 'confirm'));
  const buildFrames = () => runStep('frames', {}, []);

  // ----- markers -----

  const markerLocks: Record<TaggerId, string | null> = {
    mark: confirmed && done('Frames') ? null : confirmed ? (framesStale ? 'rebuild the frame list' : 'build frames first') : 'confirm rallies first',
    players: !confirmed ? 'confirm rallies first' : !done('Frames') ? 'build frames first' : !done('Court map') ? 'save a court map first' : null,
    touches: !confirmed ? 'confirm rallies first' : !done('Frames') ? 'build frames first' : !done('Court map') ? 'save a court map first' : null,
  };
  const markerDone: Record<TaggerId, boolean> = { mark: done('Court map'), players: done('Players'), touches: done('Touches') };

  const rejected = video.decision === 'rejected';

  return (
    <div className="space-y-5 rounded-lg border border-slate-700 bg-slate-950 p-4" data-testid="prepare-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold">Prepare {video.path.split(/[\\/]/).pop()}</h3>
        <div className="flex flex-wrap gap-1">
          {video.readiness.steps.map((s) => (
            <span key={s.label} title={s.stale ? 'Out of date: rebuild it' : undefined} className={`rounded px-1.5 py-0.5 text-xs ${s.stale ? 'bg-amber-900 text-amber-200' : s.done ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}>
              {s.label}
            </span>
          ))}
        </div>
      </div>
      {rejected && <p className="rounded bg-red-950 p-2 text-sm text-red-200">This recording was rejected by the capture profile{video.reasons?.length ? `: ${video.reasons.map((r) => r.message).join('; ')}` : ''}. Fix the recording or its attestation and register it again.</p>}

      {/* 1. Player */}
      <section>
        <StepHeader n={1} title="Video player" done={video.fileExists} />
        {video.fileExists ? (
          <div className="space-y-2">
            <video
              key={video.id}
              ref={videoRef}
              src={`/api/admin/videos/file/?id=${encodeURIComponent(video.id)}`}
              controls
              preload="metadata"
              className="max-h-[55vh] w-full rounded bg-black"
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onSeeked={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => {
                setPlayerError(null);
                if (Number.isFinite(e.currentTarget.duration)) setMediaDuration(e.currentTarget.duration);
              }}
              onError={() =>
                setPlayerError('This browser cannot play this file. Chrome and Edge play H.264 .mp4 and .webm; HEVC, .mkv, .avi and .mts may not play. You can still type times in by hand.')
              }
            />
            {playerError && <p className="rounded bg-amber-950 p-2 text-xs text-amber-200">{playerError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button className={neutral} onClick={() => nudge(-1)}>-1 s</button>
              <button className={neutral} onClick={() => nudge(-0.1)}>-0.1 s</button>
              <span className="min-w-40 rounded bg-slate-900 px-3 py-1.5 text-center font-mono text-sm" aria-live="off" data-testid="current-time">
                {secondsText(time)} s <span className="text-slate-500">({clockText(time)})</span>
              </span>
              <button className={neutral} onClick={() => nudge(0.1)}>+0.1 s</button>
              <button className={neutral} onClick={() => nudge(1)}>+1 s</button>
              {mediaDuration > 0 && <span className="text-xs text-slate-500">of {secondsText(mediaDuration)} s</span>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-red-300">The file is missing on disk, so it cannot be played: {video.path}</p>
        )}
      </section>

      {/* 2. Anchors */}
      <section>
        <StepHeader n={2} title="Anchors" done={done('Anchors')} locked={anchorsBlocked} />
        <p className="mb-2 text-xs text-slate-400">The time of the first serve and of the end of the set, in seconds of this file.</p>
        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="space-y-1">
            <span className="block text-xs text-slate-400">First serve (s)</span>
            <span className="flex gap-1">
              <input className={`${input} w-28`} aria-label="First serve seconds" value={first} onChange={(e) => setFirst(e.target.value)} inputMode="decimal" />
              <button className={small} onClick={() => setFirst(secondsText(now()))}>Use current time</button>
            </span>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-slate-400">Set end (s)</span>
            <span className="flex gap-1">
              <input className={`${input} w-28`} aria-label="Set end seconds" value={end} onChange={(e) => setEnd(e.target.value)} inputMode="decimal" />
              <button className={small} onClick={() => setEnd(secondsText(now()))}>Use current time</button>
            </span>
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-slate-400">Capture speed (1 = real time)</span>
            <input className={`${input} w-24`} aria-label="Capture speed" value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" />
          </label>
          <label className="flex items-center gap-2 pb-1">
            <input type="checkbox" checked={offCamera} onChange={(e) => setOffCamera(e.target.checked)} />
            Server off camera
          </label>
          <button className={primary} disabled={!idle || Boolean(anchorsBlocked) || !anchorCheck.value} onClick={saveAnchors}>
            {busy === 'anchors' ? 'Saving...' : done('Anchors') ? 'Update anchors' : 'Save anchors'}
          </button>
        </div>
        {(first || end) && anchorCheck.errors.length > 0 && <p className="mt-2 text-xs text-amber-300">{anchorCheck.errors.join(' ')}</p>}
        {done('Anchors') && <Warning items={anchorWarnings} />}
        <Problem text={errors.anchors} />
        {notes.anchors && !errors.anchors && <pre className="mt-2 whitespace-pre-wrap text-xs text-emerald-300">{notes.anchors}</pre>}
      </section>

      {/* 3. Rallies */}
      <section>
        <StepHeader n={3} title="Rallies" done={done('Rallies')} locked={ralliesBlocked} />
        <fieldset disabled={Boolean(ralliesBlocked)} className="space-y-2 disabled:opacity-50">
          <p className="text-xs text-slate-400">
            {RALLY_COUNT_RULE} Each rally must start after the previous one ends
            {video.timing ? `, inside ${secondsText(video.timing.first_serve_ms / 1000)}-${secondsText(video.timing.set_end_ms / 1000)} s` : ''}, and its clip runs 1 s before the serve to 1.5 s after the dead ball.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className={primary} onClick={markServe}>Mark serve</button>
            <button className={primary} onClick={markDeadBall}>Mark dead ball</button>
            <button className={neutral} onClick={() => addRow({ serve: '', dead: '' })}>Add row</button>
            <button className={neutral} onClick={sortRows}>Sort by serve</button>
            <button className={neutral} disabled={!rallyDirty} onClick={resetRows}>Discard changes</button>
            <span className="text-xs text-slate-400">
              {rows.length} drafted, {saved.length} saved{rallyDirty ? ' (unsaved changes)' : ''}
              {rows.length < CHECK_RALLY_NUMBER ? ` - ${CHECK_RALLY_NUMBER} or more recommended` : ''}
            </span>
          </div>
          {rallyNote && <p className="text-xs text-amber-300">{rallyNote}</p>}
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr><th className="p-1">#</th><th className="p-1">Serve (s)</th><th className="p-1">Dead ball (s)</th><th className="p-1">Length</th><th className="p-1" /></tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const problem = rallyCheck.rows[i];
                  const span = spans[i];
                  return (
                    <tr key={row.key} className={`border-t border-slate-800 align-top ${problem ? 'bg-red-950/40' : ''}`} data-testid="rally-row">
                      <td className="p-1">
                        <button className={small} title="Jump to this serve" onClick={() => span.serve !== null && seek(span.serve)}>{i + 1}</button>
                      </td>
                      <td className="p-1">
                        <span className="flex gap-1">
                          <input className={`${input} w-24`} aria-label={`Rally ${i + 1} serve`} value={row.serve} onChange={(e) => editRow(row.key, 'serve', e.target.value)} inputMode="decimal" />
                          <button className={small} title="Seek to the serve" disabled={span.serve === null} onClick={() => span.serve !== null && seek(span.serve)}>Go</button>
                          <button className={small} title="Use the current time" onClick={() => editRow(row.key, 'serve', secondsText(now()))}>Now</button>
                        </span>
                      </td>
                      <td className="p-1">
                        <span className="flex gap-1">
                          <input className={`${input} w-24`} aria-label={`Rally ${i + 1} dead ball`} value={row.dead} onChange={(e) => editRow(row.key, 'dead', e.target.value)} inputMode="decimal" />
                          <button className={small} title="Seek to the dead ball" disabled={span.dead === null} onClick={() => span.dead !== null && seek(span.dead)}>Go</button>
                          <button className={small} title="Use the current time" onClick={() => editRow(row.key, 'dead', secondsText(now()))}>Now</button>
                        </span>
                      </td>
                      <td className="p-1 text-xs text-slate-400">{span.serve !== null && span.dead !== null && span.dead > span.serve ? `${secondsText(span.dead - span.serve)} s` : ''}</td>
                      <td className="p-1 text-right">
                        <button className={`${small} bg-red-900 hover:bg-red-800`} aria-label={`Delete rally ${i + 1}`} onClick={() => deleteRow(row.key)}>Delete</button>
                        {problem && <p className="mt-1 text-left text-xs text-red-300">{problem}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {rallyCheck.general.length > 0 && rows.length > 0 && <p className="text-xs text-amber-300">{rallyCheck.general.join(' ')}</p>}
          <div className="flex items-center gap-3">
            <button className={primary} disabled={!idle || !rallyCheck.ok || !rallyDirty} onClick={saveRallies}>
              {busy === 'rallies' ? 'Saving...' : done('Rallies') ? 'Update rallies' : 'Save rallies'}
            </button>
            {!rallyCheck.ok && rows.length > 0 && <span className="text-xs text-amber-300">Fix the highlighted rallies to save.</span>}
          </div>
          {done('Rallies') && rallyDirty && <Warning items={rallyWarnings} />}
        </fieldset>
        <Problem text={errors.rallies} />
        {notes.rallies && !errors.rallies && <pre className="mt-2 whitespace-pre-wrap text-xs text-emerald-300">{notes.rallies}</pre>}
      </section>

      {/* 4. Confirm */}
      <section>
        <StepHeader n={4} title="Confirm" done={confirmed} locked={saved.length ? null : 'save rallies first'} />
        {saved.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Review the saved rallies. Confirming says this sample is reviewed and good; the frame list and markers need it.</p>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400"><tr><th className="p-1">#</th><th className="p-1">Serve</th><th className="p-1">Dead ball</th><th className="p-1">Clip</th></tr></thead>
                <tbody>
                  {saved.map((r) => {
                    const clip = rallyClip(r.serve_ms / 1000, r.dead_ms / 1000);
                    return (
                      <tr key={r.number} className="border-t border-slate-800">
                        <td className="p-1">{r.number}</td>
                        <td className="p-1 font-mono">{secondsText(r.serve_ms / 1000)} s</td>
                        <td className="p-1 font-mono">{secondsText(r.dead_ms / 1000)} s</td>
                        <td className="p-1 font-mono text-slate-400">{secondsText(clip.startSec)}-{secondsText(clip.endSec)} s</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rallyDirty && <p className="text-xs text-amber-300">The rally list above has unsaved edits. Save them before confirming.</p>}
            <div className="flex items-center gap-3">
              <button className={primary} disabled={!idle || rallyDirty || confirmed || Boolean(stepGate(video, 'confirm'))} onClick={confirmRallies}>
                {busy === 'confirm' ? 'Confirming...' : confirmed ? 'Confirmed' : `Confirm ${saved.length} rallies`}
              </button>
              {confirmed && video.rally_index?.confirmed_at && <span className="text-xs text-emerald-300">Confirmed {new Date(video.rally_index.confirmed_at).toLocaleString()}</span>}
              {confirmed && <span className="text-xs text-slate-500">Edit and save the rallies above to review them again.</span>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Nothing to review yet.</p>
        )}
        <Problem text={errors.confirm} />
      </section>

      {/* 5. Frames */}
      <section>
        <StepHeader n={5} title="Frames" done={done('Frames')} stale={framesStale} locked={confirmed ? null : 'confirm rallies first'} />
        <div className="flex flex-wrap items-center gap-3">
          <button className={primary} disabled={!idle || !confirmed || Boolean(stepGate(video, 'frames'))} onClick={buildFrames}>
            {busy === 'frames' ? 'Building frame list...' : done('Frames') || framesStale ? 'Rebuild frame list' : 'Build frame list'}
          </button>
          {video.frame_list?.row_count !== undefined && <span className="text-xs text-slate-400">{video.frame_list.row_count} frames listed{framesStale ? ' (from older rallies, rebuild)' : ''}</span>}
          {busy === 'frames' && <span className="text-xs text-amber-300">Working. This page stays usable.</span>}
        </div>
        <Problem text={errors.frames} />
        {notes.frames && !errors.frames && <pre className="mt-2 whitespace-pre-wrap text-xs text-emerald-300">{notes.frames}</pre>}
      </section>

      {/* 6. Markers */}
      <section>
        <StepHeader n={6} title="Markers" done={done('Touches')} locked={markerLocks.mark} />
        <p className="mb-2 text-xs text-slate-400">Each marker opens this video. Players and touches unlock once a court map is saved.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {TAGGERS.map((t) => {
            const s = taggers[t.id];
            const lock = markerLocks[t.id];
            const here = s?.owned && s.asset === video.id;
            return (
              <div key={t.id} className="space-y-2 rounded border border-slate-800 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{t.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${markerDone[t.id] ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>{markerDone[t.id] ? 'done' : 'not done'}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s?.state === 'stopped' || !s ? (
                    <button className={primary} disabled={Boolean(lock) || busyTagger === t.id} title={lock ?? undefined} onClick={() => onTagger(t.id, 'start', video.id)}>
                      {busyTagger === t.id ? 'Starting...' : 'Start for this video'}
                    </button>
                  ) : (
                    <>
                      {s.running && (
                        <a className={`${button} bg-sky-600 hover:bg-sky-500`} href={s.url} target="_blank" rel="noreferrer">Open</a>
                      )}
                      <button
                        className={`${button} ${s.running && s.owned ? 'bg-slate-700 hover:bg-slate-600' : 'bg-amber-700 hover:bg-amber-600'}`}
                        disabled={busyTagger === t.id}
                        onClick={() => onTagger(t.id, s.running && s.owned ? 'stop' : 'force-stop', video.id)}
                      >
                        {busyTagger === t.id ? 'Stopping...' : 'Stop'}
                      </button>
                    </>
                  )}
                </div>
                {lock && s?.state === 'stopped' && <p className="text-xs text-slate-500">Locked: {lock}.</p>}
                {s?.state === 'stuck' && <p className="text-xs text-amber-300">Port {t.port} is held by something that is not responding. Stop it first.</p>}
                {s?.running && (here ? <p className="text-xs text-emerald-300">Running on this video.</p> : <p className="text-xs text-amber-300">Running{s.owned && s.asset ? ` on another video (${s.asset.slice(0, 8)})` : ''}. Stop it to start it on this video.</p>)}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
