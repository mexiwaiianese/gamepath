import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, openSync, promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { NextResponse } from 'next/server';

import { attestationArgs, isLocalAdminRequest, safeVideoName, type Attestation, type TaggerDef, type VideoAsset } from './admin-video';

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

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function taggerStatus(tagger: TaggerDef) {
  const running = await portOpen(tagger.port);
  const pids = await readPids();
  const record = pids[tagger.id];
  const owned = Boolean(record && running && pidAlive(record.pid));
  return {
    id: tagger.id,
    running,
    url: `http://127.0.0.1:${tagger.port}/`,
    owned,
    asset: owned ? record.asset : null,
    review: owned ? record.review : null,
    log: path.join(LOGS, `${tagger.id}.log`),
  };
}

export async function startTagger(tagger: TaggerDef, opts: { asset?: string | null; review?: string | null }) {
  if (await portOpen(tagger.port)) return { ok: false, error: `Port ${tagger.port} is already in use; ${tagger.label} looks like it is running.` };
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

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: env ?? process.env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: stderr + String(error) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
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

