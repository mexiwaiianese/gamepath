// Pure helpers for telling whether a tagger port is held by a healthy GamePath marker, and for finding who holds it.
// No Node APIs here so tests (and the client) can import them.

export type TaggerState = 'running' | 'stuck' | 'stopped';

/** What one HTTP probe of a tagger port saw. */
export type ProbeResult =
  | { kind: 'closed' } // nothing is listening (connection refused)
  | { kind: 'no-response' } // connected, but timed out, reset, or sent something that is not HTTP
  | { kind: 'http'; status: number; contentType: string; body: string };

export const HEALTH_SERVICE = 'gamepath-marker';

/** True when a /health reply is a GamePath marker answering for this tagger. */
export function isHealthyReply(taggerId: string, probe: ProbeResult): boolean {
  if (probe.kind !== 'http' || probe.status !== 200) return false;
  try {
    const body = JSON.parse(probe.body) as { ok?: unknown; service?: unknown; tagger?: unknown };
    return body.ok === true && body.service === HEALTH_SERVICE && body.tagger === taggerId;
  } catch {
    return false;
  }
}

/** Older markers have no /health; their index page is a GamePath HTML page. */
export function isMarkerIndexPage(probe: ProbeResult): boolean {
  return probe.kind === 'http' && probe.status === 200 && /text\/html/i.test(probe.contentType) && /<title>\s*GamePath\b/i.test(probe.body);
}

/** Should the caller also probe `/`? Only when something spoke HTTP but did not give a healthy /health (a marker started before /health existed). */
export function needsIndexFallback(taggerId: string, health: ProbeResult): boolean {
  return health.kind === 'http' && !isHealthyReply(taggerId, health);
}

/**
 * running: a GamePath marker answered properly.
 * stuck:   the port is bound but nothing valid answered, or whatever answered is not a GamePath marker.
 * stopped: nothing is listening.
 */
export function classifyTagger(taggerId: string, health: ProbeResult, index?: ProbeResult | null): TaggerState {
  if (health.kind === 'closed') return 'stopped';
  if (isHealthyReply(taggerId, health)) return 'running';
  if (index && isMarkerIndexPage(index)) return 'running';
  return 'stuck';
}

function parsePidList(values: Iterable<string | undefined>): number[] {
  const pids: number[] = [];
  for (const value of values) {
    if (value === undefined || !/^\d+$/.test(value)) continue;
    const pid = Number(value);
    if (Number.isSafeInteger(pid) && !pids.includes(pid)) pids.push(pid);
  }
  return pids;
}

const LOCAL_BIND = new Set(['127.0.0.1', '0.0.0.0', '[::]', '[::1]', '*', '::', '::1']);

/** Split "127.0.0.1:8765" / "[::]:8765" / "*:8765" into host and port. */
function splitAddress(address: string): { host: string; port: number } | null {
  const index = address.lastIndexOf(':');
  if (index < 0) return null;
  const port = Number(address.slice(index + 1));
  if (!Number.isInteger(port)) return null;
  return { host: address.slice(0, index) || '*', port };
}

/** PIDs listening on `port` (loopback or wildcard addresses only) from `netstat -ano` output. */
export function parseNetstatListeners(output: string, port: number): number[] {
  const found: (string | undefined)[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // TCP  <local>  <foreign>  <state>  <pid>
    if (cols.length < 5 || cols[0].toUpperCase() !== 'TCP') continue;
    const local = splitAddress(cols[1]);
    const foreign = splitAddress(cols[2]);
    if (!local || local.port !== port || !LOCAL_BIND.has(local.host)) continue;
    // The state word is localized on non-English Windows, so also accept a foreign port of 0 (only listeners have it).
    const listening = cols[3].toUpperCase() === 'LISTENING' || foreign?.port === 0;
    if (listening) found.push(cols[4]);
  }
  return parsePidList(found);
}

/** PIDs from `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` output (one PID per line). */
export function parseLsofPids(output: string): number[] {
  return parsePidList(output.split(/\r?\n/).map((line) => line.trim()));
}

/** PIDs listening on `port` from `ss -ltnp` output. */
export function parseSsListeners(output: string, port: number): number[] {
  const found: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    // State Recv-Q Send-Q Local:Port Peer:Port Process
    if (cols[0] !== 'LISTEN' || cols.length < 4) continue;
    const local = splitAddress(cols[3]);
    if (!local || local.port !== port || !LOCAL_BIND.has(local.host)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) found.push(match[1]);
  }
  return parsePidList(found);
}

/**
 * Which listener PIDs may be killed: never the portal itself, its parent, or the low system PIDs.
 * Returns the killable PIDs plus the ones that were refused.
 */
export function selectKillable(pids: number[], protectedPids: Array<number | undefined>): { killable: number[]; refused: number[] } {
  const blocked = new Set(protectedPids.filter((pid): pid is number => typeof pid === 'number'));
  const killable: number[] = [];
  const refused: number[] = [];
  for (const pid of pids) (blocked.has(pid) || pid <= 4 ? refused : killable).push(pid);
  return { killable, refused };
}
