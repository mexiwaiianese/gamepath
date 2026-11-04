// Node-only helpers behind the admin portal's tagger status and "Force stop": HTTP health probe, port-owner lookup, kill.
import { execFile } from 'node:child_process';
import http from 'node:http';

import {
  classifyTagger,
  needsIndexFallback,
  parseLsofPids,
  parseNetstatListeners,
  parseSsListeners,
  selectKillable,
  type ProbeResult,
  type TaggerState,
} from './tagger-health';

export const PROBE_TIMEOUT_MS = 1500;
const MAX_BODY = 64 * 1024;

/** GET http://127.0.0.1:<port><path> with one overall deadline. Never rejects. */
export function probeHttp(port: number, path: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      resolve(result);
    };
    const request = http.get({ host: '127.0.0.1', port, path, agent: false, headers: { connection: 'close', accept: '*/*' } }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= MAX_BODY) chunks.push(chunk);
      });
      const done = () =>
        finish({
          kind: 'http',
          status: response.statusCode ?? 0,
          contentType: String(response.headers['content-type'] ?? ''),
          body: Buffer.concat(chunks).toString('utf8'),
        });
      response.on('end', done);
      response.on('error', () => finish({ kind: 'no-response' }));
      response.on('aborted', () => finish({ kind: 'no-response' }));
    });
    const timer = setTimeout(() => finish({ kind: 'no-response' }), timeoutMs);
    request.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED' ? { kind: 'closed' } : { kind: 'no-response' }));
  });
}

/** Decide running / stuck / stopped for a tagger port with an HTTP check (not just a TCP connect). */
export async function probeTagger(taggerId: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<TaggerState> {
  const health = await probeHttp(port, '/health', timeoutMs);
  const index = needsIndexFallback(taggerId, health) ? await probeHttp(port, '/', timeoutMs) : null;
  return classifyTagger(taggerId, health, index);
}

function exec(cmd: string, args: string[]): Promise<{ code: number | string | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      const code = error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });
}

/** PIDs listening on a local TCP port. Windows: netstat -ano. macOS/Linux: lsof, falling back to ss. */
export async function findListeningPids(port: number): Promise<number[]> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return [];
  if (process.platform === 'win32') {
    const result = await exec('netstat', ['-ano', '-p', 'TCP']);
    return parseNetstatListeners(result.stdout, port);
  }
  const lsof = await exec('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
  const fromLsof = parseLsofPids(lsof.stdout);
  if (fromLsof.length) return fromLsof;
  if (lsof.code === 'ENOENT') return parseSsListeners((await exec('ss', ['-ltnp'])).stdout, port);
  // lsof ran but found nothing (it can also miss sockets it may not inspect); ss is a cheap second opinion.
  const ss = await exec('ss', ['-ltnp']);
  return ss.code === 'ENOENT' ? [] : parseSsListeners(ss.stdout, port);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function killPid(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await exec('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 10; i++) {
    await sleep(150);
    if (!pidAlive(pid)) return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export type ForceStopResult = { ok: boolean; killed: number[]; error?: string };

/** Kill whatever is listening on `port`, except this process and its parent. */
export async function forceStopPort(port: number): Promise<ForceStopResult> {
  const listeners = await findListeningPids(port);
  if (!listeners.length) return { ok: false, killed: [], error: `Could not find a process listening on port ${port}. It may have just exited, or this user cannot see it.` };
  const { killable, refused } = selectKillable(listeners, [process.pid, process.ppid]);
  if (!killable.length) return { ok: false, killed: [], error: `Port ${port} is held by the portal itself or a protected process (PID ${refused.join(', ')}); not stopping it.` };
  for (const pid of killable) await killPid(pid);
  // Wait for the port to be released, so the caller's recheck sees it.
  for (let i = 0; i < 20; i++) {
    if (!(await findListeningPids(port)).some((pid) => killable.includes(pid))) return { ok: true, killed: killable };
    await sleep(150);
  }
  return { ok: false, killed: killable, error: `Sent the kill to PID ${killable.join(', ')} but port ${port} is still in use. It may need to be ended from Task Manager or by an administrator.` };
}
