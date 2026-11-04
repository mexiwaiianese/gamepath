'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';

import { ATTESTATION_FLAGS, TAGGERS, type Attestation, type TaggerId, type VideoAsset } from '@/lib/admin-video';
import { markerBlocker } from '@/lib/admin-video-pipeline';

import PreparePanel from './prepare-panel';
import type { TaggerAction, TaggerStatus, Video } from './video-types';

type Result = { ok: boolean; name: string; error?: string; asset?: VideoAsset; source?: string };

const button = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40';

export default function VideoPortal() {
  const [taggers, setTaggers] = useState<Record<string, TaggerStatus>>({});
  const [videos, setVideos] = useState<Video[]>([]);
  const [defaults, setDefaults] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [review, setReview] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [attestation, setAttestation] = useState<Attestation>({});
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [progress, setProgress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [t, v] = await Promise.all([fetch('/api/admin/taggers/').then((r) => r.json()), fetch('/api/admin/videos/').then((r) => r.json())]);
    setTaggers(Object.fromEntries((t.taggers ?? []).map((s: TaggerStatus) => [s.id, s])));
    setVideos(v.videos ?? []);
    setDefaults(v.defaults ?? {});
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const fileName = (v: Video) => v.path.split(/[\\/]/).pop() ?? v.path;
  // Two recordings can share a file name (different folders); add the id so the dropdown stays unambiguous.
  const label = (v: Video) => (videos.filter((o) => fileName(o) === fileName(v)).length > 1 ? `${fileName(v)} [${v.id.slice(0, 6)}]` : fileName(v));
  const defaultLabel = (id: TaggerId) => {
    const video = videos.find((v) => v.id === defaults[id]);
    if (!video) return 'Default (nothing confirmed yet)';
    const blocker = markerBlocker(video, id, video.fileExists);
    return `Default: ${label(video)} (most recently confirmed${blocker ? `, ${blocker}` : ''})`;
  };
  const optionsFor = (id: TaggerId) => {
    const all = videos.map((v) => ({ v, blocker: markerBlocker(v, id, v.fileExists) }));
    return [...all.filter((o) => !o.blocker), ...all.filter((o) => o.blocker)];
  };

  async function tagger(id: string, action: TaggerAction, asset?: string) {
    if (action === 'force-stop') {
      const port = TAGGERS.find((t) => t.id === id)?.port;
      if (!window.confirm(`Force stop whatever is using port ${port}?\n\nThis ends the program that is listening on that port, even if it was not started from this portal.`)) return;
    }
    setBusy(id);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/taggers/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action, asset: asset || choice[id] || undefined, review: id === 'touches' ? review || undefined : undefined }),
      });
      const body = await res.json();
      if (!body.ok) setMessage(body.error ?? 'Failed.');
      else if (action === 'start' && body.url) window.open(body.url, '_blank', 'noopener');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
    refresh().catch(() => undefined);
  }

  // Parse a response body as JSON, turning non-JSON (HTML error pages, empty bodies, proxy errors) into a readable failure.
  async function readResult(res: Response, name: string): Promise<Result> {
    const text = await res.text();
    try {
      return JSON.parse(text) as Result;
    } catch {
      return { ok: false, name, error: `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${text.slice(0, 200) || 'non-JSON response'}` };
    }
  }

  async function uploadAll() {
    const out: Result[] = [];
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading and registering ${i + 1} of ${files.length}: ${file.name}`);
        try {
          const query = new URLSearchParams({ name: file.name, attestation: JSON.stringify(attestation) });
          const res = await fetch(`/api/admin/videos/upload/?${query}`, { method: 'POST', body: file });
          out.push(await readResult(res, file.name));
        } catch (error) {
          out.push({ ok: false, name: file.name, error: String(error) });
        }
        setResults([...out]);
      }
      setFiles([]);
    } finally {
      setProgress(null);
    }
    refresh();
  }

  async function addUrls() {
    setProgress('Downloading and registering URLs...');
    try {
      const res = await fetch('/api/admin/videos/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls, attestation }),
      });
      const text = await res.text();
      let body: { results?: Result[]; error?: string };
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${text.slice(0, 200) || 'non-JSON response'}`);
      }
      setResults(body.results ?? [{ ok: false, name: 'urls', error: body.error }]);
    } catch (error) {
      setResults([{ ok: false, name: 'urls', error: String(error) }]);
    } finally {
      setProgress(null);
    }
    refresh();
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Video tagging</h1>
        <p className="text-sm text-slate-400 mb-4">Prepare each recording below (anchors, rallies, confirm, frames), then start a marker for it. Each marker is a local Python server and opens in a new tab.</p>
        {message && <pre className="mb-4 whitespace-pre-wrap rounded bg-red-950 p-3 text-sm text-red-200">{message}</pre>}
        <div className="grid gap-4 md:grid-cols-3">
          {TAGGERS.map((t) => {
            const s = taggers[t.id];
            return (
              <div key={t.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{t.label}</h2>
                  <span
                    className={`text-xs rounded-full px-2 py-0.5 ${
                      s?.state === 'running' ? 'bg-emerald-900 text-emerald-200' : s?.state === 'stuck' ? 'bg-amber-900 text-amber-200' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {s ? (s.state === 'running' ? 'running' : s.state === 'stuck' ? 'Not responding' : 'stopped') : '...'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{t.description} <code>{t.id}</code> on port {t.port}</p>
                <select
                  className="w-full rounded bg-slate-800 p-1.5 text-sm"
                  value={choice[t.id] ?? ''}
                  disabled={s?.running}
                  onChange={(e) => setChoice({ ...choice, [t.id]: e.target.value })}
                >
                  <option value="">{defaultLabel(t.id)}</option>
                  {optionsFor(t.id).map(({ v, blocker }) => (
                    <option key={v.id} value={v.id} disabled={Boolean(blocker)}>
                      {label(v)}{blocker ? ` (${blocker})` : ''}
                    </option>
                  ))}
                </select>
                {t.reviewModes && (
                  <select className="w-full rounded bg-slate-800 p-1.5 text-sm" value={review} disabled={s?.running} onChange={(e) => setReview(e.target.value)}>
                    <option value="">Normal marking</option>
                    {t.reviewModes.map((m) => (
                      <option key={m} value={m}>--review {m}</option>
                    ))}
                  </select>
                )}
                <div className="flex flex-wrap gap-2">
                  {s?.running ? (
                    <a className={`${button} bg-sky-600 hover:bg-sky-500`} href={s.url} target="_blank" rel="noreferrer">Open {s.url}</a>
                  ) : (
                    <button
                      className={`${button} bg-emerald-600 hover:bg-emerald-500`}
                      disabled={busy === t.id || s?.state === 'stuck'}
                      title={s?.state === 'stuck' ? `Port ${t.port} is in use; force stop it first` : undefined}
                      onClick={() => tagger(t.id, 'start')}
                    >
                      {busy === t.id ? 'Starting...' : 'Start'}
                    </button>
                  )}
                  {s?.running && s.owned && (
                    <button className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={busy === t.id} onClick={() => tagger(t.id, 'stop')}>Stop</button>
                  )}
                  {s && s.state !== 'stopped' && !(s.running && s.owned) && (
                    <button
                      className={`${button} bg-amber-700 hover:bg-amber-600`}
                      disabled={busy === t.id}
                      title={`Ends whatever is using port ${t.port} (asks first)`}
                      onClick={() => tagger(t.id, 'force-stop')}>
                      {busy === t.id ? 'Stopping...' : 'Stop'}
                    </button>
                  )}
                </div>
                {s?.state === 'stuck' && (
                  <p className="text-xs text-amber-300">
                    Something is using port {t.port} but is not answering as a marker, so it is probably hung or is another program. Stop it, then start the marker again.
                  </p>
                )}
                {s?.running && !s.owned && <p className="text-xs text-slate-500">Started outside the portal. Stop ends whatever program is using port {t.port} (it asks first); then start it here to switch video.</p>}
                {s?.owned && s.asset && <p className="text-xs text-slate-500">Asset {s.asset.slice(0, 8)}{s.review ? `, review ${s.review}` : ''}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Add videos</h2>
        <fieldset className="flex flex-wrap gap-4 rounded border border-slate-800 p-3 text-sm">
          <legend className="px-1 text-slate-400">Attestation (applied to every video in this batch)</legend>
          {ATTESTATION_FLAGS.map((f) => (
            <label key={f.key} className="flex items-center gap-2">
              <input type="checkbox" checked={attestation[f.key] === true} onChange={(e) => setAttestation({ ...attestation, [f.key]: e.target.checked })} />
              {f.label} <code className="text-xs text-slate-500">{f.flag}</code>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
            <h3 className="font-semibold">Upload files</h3>
            <input type="file" multiple accept="video/*" className="block text-sm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            <button className={`${button} bg-emerald-600 hover:bg-emerald-500`} disabled={!files.length || Boolean(progress)} onClick={uploadAll}>
              Upload {files.length || ''} file{files.length === 1 ? '' : 's'}
            </button>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
            <h3 className="font-semibold">Add from URLs (one per line; direct files or YouTube)</h3>
            <textarea className="h-24 w-full rounded bg-slate-800 p-2 text-sm font-mono" value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="https://example.com/match.mp4" />
            <button className={`${button} bg-emerald-600 hover:bg-emerald-500`} disabled={!urls.trim() || Boolean(progress)} onClick={addUrls}>Download and register</button>
          </div>
        </div>
        {progress && <p className="text-sm text-amber-300">{progress}</p>}
        {results.length > 0 && (
          <ul className="space-y-1 text-sm">
            {results.map((r, i) => (
              <li key={i} className={r.ok ? 'text-emerald-300' : 'text-red-300'}>
                {r.ok ? 'OK' : 'FAILED'} {r.name}
                {r.asset ? ` - ${r.asset.decision}` : ''}
                {r.error ? ` - ${r.error}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Registered videos ({videos.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-400">
              <tr>
                <th className="p-2">File</th>
                <th className="p-2">Decision</th>
                <th className="p-2">Pipeline</th>
                <th className="p-2">Next step</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => {
                const next = v.readiness.steps.find((s) => !s.done);
                const expanded = open === v.id;
                return (
                  <Fragment key={v.id}>
                    <tr className="border-t border-slate-800 align-top">
                      <td className="p-2">
                        <div className="font-medium">{fileName(v)}</div>
                        <div className="text-xs text-slate-500 break-all">{v.path}{v.fileExists ? '' : ' (missing on disk)'}</div>
                      </td>
                      <td className="p-2">
                        {v.decision}
                        {v.flags?.length ? <div className="text-xs text-slate-500">{v.flags.join(', ')}</div> : null}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {v.readiness.steps.map((s) => (
                            <span
                              key={s.label}
                              title={s.stale ? 'Out of date: rebuild it' : undefined}
                              className={`rounded px-1.5 py-0.5 text-xs ${s.stale ? 'bg-amber-900 text-amber-200' : s.done ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}
                            >
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-2 text-xs text-slate-300">{next ? (next.stale ? `Rebuild ${next.label.toLowerCase()}` : next.label) : 'All steps done'}</td>
                      <td className="p-2 text-right">
                        <button className={`${button} bg-sky-700 hover:bg-sky-600`} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : v.id)}>
                          {expanded ? 'Close' : 'Prepare'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={5} className="p-2">
                          <PreparePanel key={v.id} video={v} taggers={taggers} busyTagger={busy} onTagger={(id, action, asset) => tagger(id, action, asset)} onChanged={refresh} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

