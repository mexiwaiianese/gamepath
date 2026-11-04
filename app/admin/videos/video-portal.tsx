'use client';

import { useCallback, useEffect, useState } from 'react';

import { ATTESTATION_FLAGS, TAGGERS, type Attestation, type Readiness, type VideoAsset } from '@/lib/admin-video';

type TaggerStatus = { id: string; running: boolean; url: string; owned: boolean; asset: string | null; review: string | null; log: string };
type Video = VideoAsset & { fileExists: boolean; readiness: Readiness };
type Result = { ok: boolean; name: string; error?: string; asset?: VideoAsset; source?: string };

const button = 'rounded px-3 py-1.5 text-sm font-medium disabled:opacity-40';

export default function VideoPortal() {
  const [taggers, setTaggers] = useState<Record<string, TaggerStatus>>({});
  const [videos, setVideos] = useState<Video[]>([]);
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
  }, []);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const ready = videos.filter((v) => v.readiness.markerReady && v.fileExists);

  async function tagger(id: string, action: 'start' | 'stop') {
    setBusy(id);
    setMessage(null);
    const res = await fetch('/api/admin/taggers/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, action, asset: choice[id] || undefined, review: id === 'touches' ? review || undefined : undefined }),
    });
    const body = await res.json();
    setBusy(null);
    if (!body.ok) setMessage(body.error ?? 'Failed.');
    else if (action === 'start' && body.url) window.open(body.url, '_blank', 'noopener');
    refresh();
  }

  async function uploadAll() {
    const out: Result[] = [];
    for (const [i, file] of files.entries()) {
      setProgress(`Uploading and registering ${i + 1} of ${files.length}: ${file.name}`);
      try {
        const query = new URLSearchParams({ name: file.name, attestation: JSON.stringify(attestation) });
        const res = await fetch(`/api/admin/videos/upload/?${query}`, { method: 'POST', body: file });
        out.push(await res.json());
      } catch (error) {
        out.push({ ok: false, name: file.name, error: String(error) });
      }
      setResults([...out]);
    }
    setProgress(null);
    setFiles([]);
    refresh();
  }

  async function addUrls() {
    setProgress('Downloading and registering URLs...');
    const res = await fetch('/api/admin/videos/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls, attestation }),
    });
    const body = await res.json();
    setResults(body.results ?? [{ ok: false, name: 'urls', error: body.error }]);
    setProgress(null);
    refresh();
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Video tagging</h1>
        <p className="text-sm text-slate-400 mb-4">Each tagger is a local Python server. Pick a confirmed recording, start it, and it opens in a new tab.</p>
        {message && <pre className="mb-4 whitespace-pre-wrap rounded bg-red-950 p-3 text-sm text-red-200">{message}</pre>}
        <div className="grid gap-4 md:grid-cols-3">
          {TAGGERS.map((t) => {
            const s = taggers[t.id];
            return (
              <div key={t.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{t.label}</h2>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${s?.running ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                    {s ? (s.running ? 'running' : 'stopped') : '...'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{t.description} <code>{t.id}</code> on port {t.port}</p>
                <select
                  className="w-full rounded bg-slate-800 p-1.5 text-sm"
                  value={choice[t.id] ?? ''}
                  disabled={s?.running}
                  onChange={(e) => setChoice({ ...choice, [t.id]: e.target.value })}
                >
                  <option value="">Default (newest confirmed)</option>
                  {ready.map((v) => (
                    <option key={v.id} value={v.id}>{v.path.split(/[\\/]/).pop()}</option>
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
                <div className="flex gap-2">
                  {s?.running ? (
                    <a className={`${button} bg-sky-600 hover:bg-sky-500`} href={s.url} target="_blank" rel="noreferrer">Open {s.url}</a>
                  ) : (
                    <button className={`${button} bg-emerald-600 hover:bg-emerald-500`} disabled={busy === t.id} onClick={() => tagger(t.id, 'start')}>
                      {busy === t.id ? 'Starting...' : 'Start'}
                    </button>
                  )}
                  {s?.running && s.owned && (
                    <button className={`${button} bg-slate-700 hover:bg-slate-600`} disabled={busy === t.id} onClick={() => tagger(t.id, 'stop')}>Stop</button>
                  )}
                </div>
                {s?.running && !s.owned && <p className="text-xs text-slate-500">Started outside the portal; stop it in its own window. To switch video, stop it first.</p>}
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
                <th className="p-2">Next CLI step</th>
              </tr>
            </thead>
            <tbody>
              {videos.map((v) => {
                const next = v.readiness.steps.find((s) => !s.done);
                return (
                  <tr key={v.id} className="border-t border-slate-800 align-top">
                    <td className="p-2">
                      <div className="font-medium">{v.path.split(/[\\/]/).pop()}</div>
                      <div className="text-xs text-slate-500 break-all">{v.path}{v.fileExists ? '' : ' (missing on disk)'}</div>
                    </td>
                    <td className="p-2">
                      {v.decision}
                      {v.flags?.length ? <div className="text-xs text-slate-500">{v.flags.join(', ')}</div> : null}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {v.readiness.steps.map((s) => (
                          <span key={s.label} className={`rounded px-1.5 py-0.5 text-xs ${s.done ? 'bg-emerald-900 text-emerald-200' : 'bg-slate-800 text-slate-500'}`}>{s.label}</span>
                        ))}
                      </div>
                    </td>
                    <td className="p-2 text-xs">
                      {next ? <code className="break-all text-slate-300">python -m gamepath_video {next.command}</code> : 'done'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

