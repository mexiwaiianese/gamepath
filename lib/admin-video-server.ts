import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, openSync, promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { NextResponse } from 'next/server';

import {
  attestationArgs,
  isLocalAdminRequest,
  safeVideoName,
  ytDlpArgs,
  ytDlpError,
  type Attestation,
  type TaggerDef,
  type VideoAsset,
  type YouTubeLink,
} from './admin-video';
import {
  anchorsArgs,
  confirmArgs,
  framesArgs,
  invalidationWarnings,
  parseByteRange,
  ralliesArgs,
  stepGate,
  validateAnchors,
  validateRallies,
  videoMime,
  type PipelineStep,
} from './admin-video-pipeline';
import { forceStopPort, pidAlive, probeTagger } from './tagger-process';

export const ROOT = process.cwd();
export const VIDEOS_DIR = path.join(ROOT, 'videos');
const STATE_DIR = path.join(ROOT, '.gamepath');
const REGISTRY = path.join(STATE_DIR, 'video-assets.json');
const PIDS = path.join(STATE_DIR, 'admin-taggers.json');
const LOGS = path.join(STATE_DIR, 'logs');
const PYTHON = process.env.GAMEPATH_PYTHON || 'python';

export function guard(request: Request): NextResponse | null {
  const ok = isLocalAdminRequest({
    nodeEnv: process.env.NODE_ENV,
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    forwardedFor: request.headers.get('x-forwarded-for'),
  });
  return ok ? null : NextResponse.json({ error: 'Admin is available only in development on localhost.' }, { status: 403 });
}

function pythonEnv(): NodeJS.ProcessEnv {
  const extra = path.join(ROOT, 'services', 'video');
  const current = process.env.PYTHONPATH;
  return { ...process.env, PYTHONPATH: current ? `${extra}${path.delimiter}${current}` : extra, PYTHONIOENCODING: 'utf-8' };
}

export async function readAssets(): Promise<VideoAsset[]> {
  try {
    const payload = JSON.parse(await fs.readFile(REGISTRY, 'utf8'));
    return Array.isArray(payload.assets) ? payload.assets : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function portOpen(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

type PidRecord = { pid: number; asset: string | null; review: string | null; startedAt: string };

async function readPids(): Promise<Record<string, PidRecord>> {
  try {
    return JSON.parse(await fs.readFile(PIDS, 'utf8'));
  } catch {
    return {};
  }
}

async function writePids(pids: Record<string, PidRecord>) {
  await fs.mkdir(STATE_DIR, { recursive: true });
  await fs.writeFile(PIDS, JSON.stringify(pids, null, 2));
}

/**
 * state: running = a GamePath marker answered an HTTP health check; stuck = the port is bound but nothing valid answered
 * (hung, or not a marker); stopped = nothing listening. `running` is kept as a boolean for older callers.
 */
export async function taggerStatus(tagger: TaggerDef) {
  const state = await probeTagger(tagger.id, tagger.port);
  const pids = await readPids();
  const record = pids[tagger.id];
  const owned = Boolean(record && state === 'running' && pidAlive(record.pid));
  return {
    id: tagger.id,
    state,
    running: state === 'running',
    url: `http://127.0.0.1:${tagger.port}/`,
    owned,
    asset: owned ? record.asset : null,
    review: owned ? record.review : null,
    log: path.join(LOGS, `${tagger.id}.log`),
  };
}

export async function startTagger(tagger: TaggerDef, opts: { asset?: string | null; review?: string | null }) {
  const state = await probeTagger(tagger.id, tagger.port);
  if (state === 'running') return { ok: false, error: `Port ${tagger.port} is already in use; ${tagger.label} looks like it is running.` };
  if (state === 'stuck') return { ok: false, error: `Port ${tagger.port} is held by something that is not responding. Use Stop to clear it, then start ${tagger.label}.` };
  await fs.mkdir(LOGS, { recursive: true });
  const logPath = path.join(LOGS, `${tagger.id}.log`);
  const out = openSync(logPath, 'w');
  const args = ['-m', 'gamepath_video', tagger.id, '--port', String(tagger.port), '--no-browser'];
  if (opts.asset) args.push('--asset', opts.asset);
  if (opts.review && tagger.reviewModes?.includes(opts.review)) args.push('--review', opts.review);
  const child = spawn(PYTHON, args, { cwd: ROOT, env: pythonEnv(), detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  const pid = child.pid;
  if (!pid) return { ok: false, error: 'Python did not start. Set GAMEPATH_PYTHON if python is not on PATH.' };
  // Give the server a few seconds to bind, or report the CLI error from the log.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await portOpen(tagger.port)) {
      const pids = await readPids();
      pids[tagger.id] = { pid, asset: opts.asset ?? null, review: opts.review ?? null, startedAt: new Date().toISOString() };
      await writePids(pids);
      return { ok: true, url: `http://127.0.0.1:${tagger.port}/` };
    }
    if (!pidAlive(pid)) break;
  }
  const log = (await fs.readFile(logPath, 'utf8').catch(() => '')).trim();
  return { ok: false, error: log || 'Tagger exited before it opened its port.' };
}

export async function stopTagger(tagger: TaggerDef) {
  const pids = await readPids();
  const record = pids[tagger.id];
  if (!record || !pidAlive(record.pid)) {
    delete pids[tagger.id];
    await writePids(pids);
    return { ok: false, error: 'This tagger was not started from the portal; stop it in its own window.' };
  }
  if (process.platform === 'win32') {
    await run('taskkill', ['/PID', String(record.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-record.pid, 'SIGTERM');
    } catch {
      process.kill(record.pid, 'SIGTERM');
    }
  }
  delete pids[tagger.id];
  await writePids(pids);
  return { ok: true };
}

/** Kill whatever listens on the tagger's port (stuck, or started outside the portal), then report the fresh status. */
export async function forceStopTagger(tagger: TaggerDef) {
  const result = await forceStopPort(tagger.port);
  const pids = await readPids();
  if (result.ok && pids[tagger.id]) {
    delete pids[tagger.id];
    await writePids(pids);
  }
  return { ...result, status: await taggerStatus(tagger) };
}

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: env ?? process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number, extra = '') => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr + extra });
    };
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill();
          finish(-1, `\nTimed out after ${Math.round(timeoutMs / 1000)} s.`);
        }, timeoutMs)
      : null;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (error) => finish(-1, String(error)));
    child.on('close', (code) => finish(code ?? -1));
  });
}

export async function uniqueVideoPath(name: string): Promise<string> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });
  const safe = safeVideoName(name);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let candidate = path.join(VIDEOS_DIR, safe);
  for (let i = 1; existsSync(candidate); i++) candidate = path.join(VIDEOS_DIR, `${stem}-${i}${ext}`);
  return candidate;
}

export async function saveStream(body: ReadableStream<Uint8Array>, dest: string) {
  const temporary = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>), createWriteStream(temporary));
    await fs.rename(temporary, dest);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export type RegisterResult = { ok: boolean; name: string; path?: string; asset?: VideoAsset; error?: string };

export async function registerVideo(filePath: string, attestation: Attestation): Promise<RegisterResult> {
  const name = path.basename(filePath);
  const result = await run(PYTHON, ['-m', 'gamepath_video', 'register', filePath, '--json', ...attestationArgs(attestation)], pythonEnv());
  // Exit 0 = accepted, 2 = recorded but rejected by gym-baseline-v1.
  if (result.code === 0 || result.code === 2) {
    try {
      const asset = JSON.parse(result.stdout) as VideoAsset;
      const reasons = asset.reasons?.map((r) => r.message).join('; ');
      return { ok: result.code === 0, name, path: filePath, asset, error: result.code === 2 ? `Rejected: ${reasons}` : undefined };
    } catch {
      return { ok: false, name, path: filePath, error: result.stdout || 'Could not read register output.' };
    }
  }
  return { ok: false, name, path: filePath, error: (result.stderr || result.stdout).trim() || `register exited ${result.code}` };
}


let ffmpegAvailable: Promise<boolean> | null = null;

export function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= run('ffmpeg', ['-version']).then((result) => result.code === 0);
  return ffmpegAvailable;
}

/** Download a YouTube video (or an explicitly pasted playlist) into videos/ with yt-dlp; returns the saved files. */
export async function downloadYouTube(link: YouTubeLink): Promise<{ files: string[]; error?: string }> {
  await fs.mkdir(VIDEOS_DIR, { recursive: true });
  const result = await run(PYTHON, ytDlpArgs(link, VIDEOS_DIR, { ffmpeg: await hasFfmpeg() }), pythonEnv());
  const files = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && existsSync(line));
  if (result.code !== 0 && !files.length) {
    const message = /No module named yt_dlp/.test(result.stderr) ? 'yt-dlp is not installed for this Python (python -m pip install -U yt-dlp).' : ytDlpError(result.stderr);
    return { files, error: message };
  }
  return { files, error: result.code !== 0 ? ytDlpError(result.stderr) : undefined };
}

// ---------- per-video preparation (anchors, rallies, confirm, frames) ----------

let pipelineQueue: Promise<unknown> = Promise.resolve();

/** The registry is a read-modify-write JSON file, so portal-started CLI writes run one at a time. */
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = pipelineQueue.then(job, job);
  pipelineQueue = next.catch(() => undefined);
  return next;
}

export async function findAsset(id: string): Promise<VideoAsset | undefined> {
  return (await readAssets()).find((asset) => asset.id === id);
}

/** Modified time of an asset's frame list file; null when the registry points at a file that is gone. */
export async function frameListBuiltAtMs(asset: VideoAsset): Promise<number | null | undefined> {
  const listPath = asset.frame_list?.path;
  if (!asset.frame_list) return undefined;
  if (!listPath) return null;
  try {
    return (await fs.stat(listPath)).mtimeMs;
  } catch {
    return null;
  }
}

export type PipelineResult = { ok: boolean; error?: string; output?: string; warnings?: string[]; asset?: VideoAsset };

const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000;

const finiteNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Run one preparation step through the Python CLI with an argument array (no shell). The CLI stays the authority;
 * the checks here only give a readable message before it runs and keep the steps in order.
 */
export function runPipelineStep(id: string, step: PipelineStep, input: unknown): Promise<PipelineResult> {
  return exclusive(async () => {
    try {
      const asset = await findAsset(id);
      if (!asset) return { ok: false, error: 'Unknown video.' };
      const blocked = stepGate(asset, step);
      if (blocked) return { ok: false, error: blocked };
      if (!existsSync(asset.path)) return { ok: false, error: `Recording not found on disk: ${asset.path}` };
      const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
      let args: string[];
      const warnings: string[] = [];
      if (step === 'anchors') {
        const check = validateAnchors(
          {
            firstServe: String(finiteNumber(body.firstServeSec) ?? ''),
            setEnd: String(finiteNumber(body.setEndSec) ?? ''),
            captureSpeed: String(finiteNumber(body.captureSpeed) ?? ''),
            serverOffCamera: body.serverOffCamera === true,
          },
          asset.probe?.duration_ms,
        );
        if (!check.value) return { ok: false, error: check.errors.join(' ') };
        warnings.push(...invalidationWarnings(asset, 'anchors', { anchors: check.value }));
        args = anchorsArgs(asset.path, check.value);
      } else if (step === 'rallies') {
        const raw = Array.isArray(body.rallies) ? body.rallies : [];
        const spans = raw.map((item) => ({ serve: finiteNumber((item as Record<string, unknown>)?.serve), dead: finiteNumber((item as Record<string, unknown>)?.dead) }));
        const check = validateRallies(spans, asset.timing, asset.probe?.duration_ms);
        if (!check.ok) return { ok: false, error: [...check.general, ...check.rows.filter(Boolean)].join(' ') };
        warnings.push(...invalidationWarnings(asset, 'rallies'));
        args = ralliesArgs(asset.path, spans as { serve: number; dead: number }[]);
      } else if (step === 'confirm') {
        warnings.push(...invalidationWarnings(asset, 'confirm'));
        args = confirmArgs(asset.path);
      } else {
        args = framesArgs(asset.path);
      }
      const result = await run(PYTHON, ['-m', 'gamepath_video', ...args], pythonEnv(), PIPELINE_TIMEOUT_MS);
      if (result.code !== 0) {
        const text = (result.stderr || result.stdout).trim();
        const notFound = result.code === -1 && /ENOENT/.test(result.stderr) ? 'Python did not start. Set GAMEPATH_PYTHON if python is not on PATH.' : '';
        return { ok: false, error: notFound || text || `The ${step} command exited with code ${result.code}.` };
      }
      return { ok: true, output: result.stdout.trim(), warnings, asset: await findAsset(id) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

// ---------- serving a registered video to the browser (HTTP Range) ----------

/** Stream a registered recording by asset id (never by a path from the request), with Range support so seeking works. */
export async function videoFileResponse(request: Request, id: string, headOnly = false): Promise<Response> {
  const asset = await findAsset(id);
  if (!asset) return NextResponse.json({ error: 'Unknown video.' }, { status: 404 });
  let size: number;
  try {
    const stat = await fs.stat(asset.path);
    if (!stat.isFile()) throw new Error('not a file');
    size = stat.size;
  } catch {
    return NextResponse.json({ error: `Recording not found on disk: ${asset.path}` }, { status: 404 });
  }
  const base: Record<string, string> = {
    'Content-Type': videoMime(asset.path),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-transform, max-age=0',
  };
  const range = parseByteRange(request.headers.get('range'), size);
  if (range.kind === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  const start = range.kind === 'range' ? range.start : 0;
  const end = range.kind === 'range' ? range.end : size - 1;
  const headers: Record<string, string> = { ...base, 'Content-Length': String(size === 0 ? 0 : end - start + 1) };
  if (range.kind === 'range') headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  const status = range.kind === 'range' ? 206 : 200;
  if (headOnly || size === 0) return new Response(null, { status, headers });
  const stream = createReadStream(asset.path, { start, end });
  stream.on('error', () => stream.destroy());
  request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>, { status, headers });
}
