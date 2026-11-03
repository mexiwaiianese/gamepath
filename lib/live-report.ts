/** Addresses for the live report. Safe to import from the browser. */

export const LIVE_REPORT_PORT = 3850;

export function liveMatchEndpoint(matchId: string, token: string) {
  const url = new URL(`http://${window.location.hostname}:${LIVE_REPORT_PORT}/matches/${encodeURIComponent(matchId)}`);
  url.searchParams.set('token', token);
  return url.toString();
}

export function liveDeviceEndpoint() {
  return `http://${window.location.hostname}:${LIVE_REPORT_PORT}/devices`;
}

export function liveCameraEndpoint(matchId: string, cameraId: string, token: string) {
  const url = new URL(`http://${window.location.hostname}:${LIVE_REPORT_PORT}/matches/${encodeURIComponent(matchId)}/cameras/${encodeURIComponent(cameraId)}`);
  url.searchParams.set('token', token);
  return url.toString();
}

export function deviceJoinUrl(origin: string, matchId: string, token: string) {
  const url = new URL(origin);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', token);
  url.searchParams.set('match', matchId);
  return url.toString();
}

export function reportPageUrl(origin: string, matchId: string, token: string) {
  const parsed = new URL(origin);
  parsed.pathname = '/report/';
  parsed.search = '';
  parsed.hash = '';
  parsed.searchParams.set('match', matchId);
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

export function preferredShareOrigin(location: Pick<Location, 'hostname' | 'origin' | 'port' | 'protocol'>) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    const port = location.port || (location.protocol === 'https:' ? '443' : '80');
    return `http://192.168.137.1:${port}`;
  }
  return location.origin;
}

/** A joined stat phone shows the master scoreboard. The master computer keeps the book it is entering. */
export function followsCommittedScoreboard(input: { deviceMaster?: boolean; deviceId: string; masterDeviceId?: string | null }) {
  return input.deviceMaster !== true && Boolean(input.masterDeviceId) && input.masterDeviceId !== input.deviceId;
}

export function liveHostEndpoint() {
  return `http://127.0.0.1:${LIVE_REPORT_PORT}/host`;
}

/** The address a phone can open. On this computer, ask the live service which LAN address is actually up. */
export async function resolveShareOrigin(location: Pick<Location, 'hostname' | 'origin' | 'port' | 'protocol'>) {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return location.origin;
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  try {
    const response = await fetch(liveHostEndpoint(), { cache: 'no-store' });
    const body = await response.json() as { host?: string };
    if (response.ok && body.host && body.host !== '127.0.0.1') return `http://${body.host}:${port}`;
  } catch { /* fall through to the hotspot address */ }
  return preferredShareOrigin(location);
}
