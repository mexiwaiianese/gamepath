/** Serves the live match report on the team network. Does not read or write other GamePath files. */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookupMac } from '../lib/keeper-mac';
import { LIVE_REPORT_PORT } from '../lib/live-report';
import {
  LIVE_STORE_SCHEMA,
  LivePublishError,
  emptyLiveStore,
  publishLiveMatch,
  readLiveMatch,
  registerLiveDevice,
  submitKeeperBook,
  updateLiveCamera,
  type DeviceRole,
  type LiveRecord,
  type LiveRosterEntry,
  type LiveStore,
} from '../lib/live-store';
import { STAT_ACCURACY_SCHEMA, emptyAccuracyFile, historicalAccuracy, withMatchSlices, type AccuracyFile } from '../lib/stat-accuracy';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const filePath = path.join(root, '.gamepath', 'live-matches.json');
const accuracyPath = path.join(root, '.gamepath', 'stat-accuracy.json');
let writing = Promise.resolve();

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/devices' && request.method === 'POST') {
    void enroll(request, response);
    return;
  }
  const camera = cameraFrom(url.pathname);
  if (camera && request.method === 'PUT') {
    void saveCamera(request, response, camera.matchId, camera.cameraId);
    return;
  }
  const matchId = matchIdFrom(url.pathname);
  if (!matchId) {
    send(response, 404, { message: 'Not found' });
    return;
  }
  if (request.method === 'GET') {
    try {
      const record = readLiveMatch(loadStore(), matchId, url.searchParams.get('token') ?? '');
      send(response, 200, payload(record));
    } catch (error) {
      fail(response, error);
    }
    return;
  }
  if (request.method === 'PUT') {
    void publish(request, response, matchId);
    return;
  }
  send(response, 404, { message: 'Not found' });
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`Live report already running on ${LIVE_REPORT_PORT}`);
    process.exit(0);
  }
  throw error;
});

server.listen(LIVE_REPORT_PORT, '0.0.0.0', () => {
  console.log(`Live report: http://0.0.0.0:${LIVE_REPORT_PORT}`);
});

async function publish(request: http.IncomingMessage, response: http.ServerResponse, matchId: string) {
  writing = writing.then(async () => {
    try {
      const body = await readBody(request);
      const token = typeof body.token === 'string' ? body.token : '';
      const match = body.match;
      if (!match || typeof match !== 'object' || Array.isArray(match)) throw new LivePublishError('Match snapshot is missing.', 400);
      const roster = normalizeRoster(body.roster);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId : undefined;
      const updatedAt = new Date().toISOString();
      if (deviceId) {
        const accuracy = loadAccuracy();
        const result = submitKeeperBook(loadStore(), matchId, token, deviceId, match as Record<string, unknown>, roster, updatedAt, {
          mac: lookupMac(request.socket.remoteAddress ?? '') ?? `device:${deviceId}`,
          label: typeof body.label === 'string' ? body.label : '',
          claimMaster: body.master === true,
          accuracyByMac: historicalAccuracy(accuracy, matchId),
        });
        saveStore(result.store);
        saveAccuracy(withMatchSlices(accuracy, matchId, result.slices));
        send(response, 200, payload(result.store.matches[matchId]));
        return;
      }
      const baseRevision = typeof body.baseRevision === 'number' ? body.baseRevision : undefined;
      const next = publishLiveMatch(loadStore(), matchId, token, match as Record<string, unknown>, roster, updatedAt, { baseRevision });
      saveStore(next);
      send(response, 200, payload(next.matches[matchId]));
    } catch (error) {
      fail(response, error);
    }
  });
  await writing;
}

async function enroll(request: http.IncomingMessage, response: http.ServerResponse) {
  writing = writing.then(async () => {
    try {
      const body = await readBody(request);
      const role = body.role === 'stat' || body.role === 'coach' || body.role === 'camera' ? body.role as DeviceRole : null;
      if (!role) throw new LivePublishError('Choose stat keeping, coach, or camera.', 400);
      const next = registerLiveDevice(loadStore(), {
        id: typeof body.deviceId === 'string' ? body.deviceId : '',
        role,
        label: typeof body.label === 'string' ? body.label : '',
        matchId: typeof body.matchId === 'string' ? body.matchId : '',
        token: typeof body.token === 'string' ? body.token : '',
        cameraId: typeof body.cameraId === 'string' ? body.cameraId : undefined,
        seenAt: new Date().toISOString(),
      });
      saveStore(next);
      send(response, 200, { device: next.devices[typeof body.deviceId === 'string' ? body.deviceId : ''] });
    } catch (error) {
      fail(response, error);
    }
  });
  await writing;
}

async function saveCamera(request: http.IncomingMessage, response: http.ServerResponse, matchId: string, cameraId: string) {
  writing = writing.then(async () => {
    try {
      const body = await readBody(request);
      const next = updateLiveCamera(loadStore(), matchId, typeof body.token === 'string' ? body.token : '', {
        id: cameraId,
        position: typeof body.position === 'string' ? body.position : '',
        pictureEdge: typeof body.pictureEdge === 'string' ? body.pictureEdge : '',
      }, typeof body.deviceId === 'string' ? body.deviceId : '', new Date().toISOString());
      saveStore(next);
      send(response, 200, { revision: next.matches[matchId].revision, match: next.matches[matchId].match });
    } catch (error) {
      fail(response, error);
    }
  });
  await writing;
}

function cameraFrom(pathname: string) {
  const match = pathname.match(/^\/matches\/([^/]+)\/cameras\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return { matchId: decodeURIComponent(match[1]), cameraId: decodeURIComponent(match[2]) };
  } catch {
    return null;
  }
}

function fail(response: http.ServerResponse, error: unknown) {
  const status = error instanceof LivePublishError ? error.status : 500;
  const current = error instanceof LivePublishError ? error.current : undefined;
  send(response, status, {
    message: error instanceof Error ? error.message : 'Could not save.',
    ...(current ? { match: current.match, roster: current.roster, revision: current.revision ?? 0, updatedAt: current.updatedAt } : {}),
  });
}

function matchIdFrom(pathname: string) {
  const match = pathname.match(/^\/matches\/([^/]+)\/?$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function normalizeRoster(value: unknown): LiveRosterEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const id = 'id' in entry && typeof entry.id === 'string' ? entry.id : '';
    const jersey = 'jersey' in entry && typeof entry.jersey === 'number' ? entry.jersey : null;
    if (!id || jersey === null) return [];
    const rosterEntry: LiveRosterEntry = { id, jersey };
    if ('firstName' in entry && typeof entry.firstName === 'string') rosterEntry.firstName = entry.firstName;
    if ('lastName' in entry && typeof entry.lastName === 'string') rosterEntry.lastName = entry.lastName;
    if ('positions' in entry && Array.isArray(entry.positions)) rosterEntry.positions = entry.positions.filter((item) => typeof item === 'string');
    if ('libero' in entry && typeof entry.libero === 'boolean') rosterEntry.libero = entry.libero;
    return [rosterEntry];
  });
}

function payload(record: LiveRecord) {
  return {
    match: record.match,
    roster: record.roster,
    updatedAt: record.updatedAt,
    revision: record.revision ?? 0,
    confidence: record.statConfidence ?? 0,
    confirmed: record.statConfirmed ?? 0,
    accepted: record.statAccepted ?? 0,
    pending: record.pendingStats ?? [],
    masterDeviceId: record.masterDeviceId ?? null,
  };
}

function loadAccuracy(): AccuracyFile {
  if (!fs.existsSync(accuracyPath)) return emptyAccuracyFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(accuracyPath, 'utf8')) as AccuracyFile;
    if (parsed.schema !== STAT_ACCURACY_SCHEMA || !parsed.keepers) return emptyAccuracyFile();
    return parsed;
  } catch {
    return emptyAccuracyFile();
  }
}

function saveAccuracy(file: AccuracyFile) {
  fs.mkdirSync(path.dirname(accuracyPath), { recursive: true });
  const temporary = `${accuracyPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(file));
  fs.renameSync(temporary, accuracyPath);
}

function loadStore(): LiveStore {
  if (!fs.existsSync(filePath)) return emptyLiveStore();
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as LiveStore;
  if (parsed.schema !== LIVE_STORE_SCHEMA || !parsed.matches) throw new LivePublishError('Live report file could not be read.', 500);
  return { ...parsed, devices: parsed.devices ?? {} };
}

function saveStore(store: LiveStore) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store));
  fs.renameSync(temporary, filePath);
}

function readBody(request: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new LivePublishError('Match snapshot is too large.', 400));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>);
      } catch {
        reject(new LivePublishError('Match snapshot was not valid.', 400));
      }
    });
    request.on('error', reject);
  });
}

function send(response: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' });
  response.end(payload);
}
