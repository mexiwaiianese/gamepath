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
