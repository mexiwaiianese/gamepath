/** Published match snapshots. A wrong token cannot replace a snapshot. */

import { timingSafeEqual } from 'node:crypto';

export const LIVE_STORE_SCHEMA = 'gamepath.live_matches.v1';

export type DeviceRole = 'stat' | 'coach' | 'camera';

export type LiveRosterEntry = {
  id: string;
  jersey: number;
  firstName?: string;
  lastName?: string;
  positions?: string[];
  libero?: boolean;
};

export type LiveRecord = {
  token: string;
  match: Record<string, unknown>;
  roster: LiveRosterEntry[];
  updatedAt: string;
  revision: number;
};

export type LiveDevice = {
  id: string;
  role: DeviceRole;
  label: string;
  matchId: string;
  cameraId?: string;
  seenAt: string;
};

export type LiveStore = {
  schema: typeof LIVE_STORE_SCHEMA;
  matches: Record<string, LiveRecord>;
  devices: Record<string, LiveDevice>;
};

export class LivePublishError extends Error {
  constructor(message: string, readonly status: number, readonly current?: LiveRecord) {
    super(message);
  }
}

export function emptyLiveStore(): LiveStore {
  return { schema: LIVE_STORE_SCHEMA, matches: {}, devices: {} };
}

export function publishLiveMatch(
  store: LiveStore,
  matchId: string,
  token: string,
  match: Record<string, unknown>,
  roster: LiveRosterEntry[],
  updatedAt: string,
  options?: { baseRevision?: number; deviceId?: string },
): LiveStore {
  if (!matchId || !token) throw new LivePublishError('A match and its private token are required.', 400);
  const existing = store.matches[matchId];
  if (existing && !tokensMatch(existing.token, token)) {
    throw new LivePublishError('That private link does not match this match.', 403, existing);
  }
  assertStatDevice(store, matchId, options?.deviceId, existing);
  if (existing && options?.baseRevision !== undefined && options.baseRevision !== (existing.revision ?? 0)) {
    throw new LivePublishError('Another stat keeper saved first. This device will show that version.', 409, existing);
  }
  return {
    ...store,
    schema: LIVE_STORE_SCHEMA,
    matches: {
      ...store.matches,
      [matchId]: { token, match, roster, updatedAt, revision: (existing?.revision ?? 0) + 1 },
    },
  };
}

export function registerLiveDevice(
  store: LiveStore,
  input: { id: string; role: DeviceRole; label: string; matchId: string; token: string; cameraId?: string; seenAt: string },
): LiveStore {
  const existing = store.matches[input.matchId];
  if (!existing || !tokensMatch(existing.token, input.token)) {
    throw new LivePublishError('This join link does not match a match on the host.', existing ? 403 : 404);
  }
  if (!input.id || !['stat', 'coach', 'camera'].includes(input.role)) {
    throw new LivePublishError('Choose stat keeping, coach, or camera.', 400);
  }
  const prior = store.devices[input.id];
  return {
    ...store,
    devices: {
      ...store.devices,
      [input.id]: {
        id: input.id,
        role: input.role,
        label: input.label.trim() || prior?.label || 'Device',
        matchId: input.matchId,
        cameraId: input.cameraId || prior?.cameraId,
        seenAt: input.seenAt,
      },
    },
  };
}

export function updateLiveCamera(
  store: LiveStore,
  matchId: string,
  token: string,
  camera: { id: string; position: string; pictureEdge: string },
  deviceId: string,
  updatedAt: string,
): LiveStore {
  const existing = store.matches[matchId];
  if (!existing || !tokensMatch(existing.token, token)) {
    throw new LivePublishError('This camera link does not match the match on the host.', existing ? 403 : 404);
  }
  const device = store.devices[deviceId];
  if (!device || device.role !== 'camera' || device.matchId !== matchId) {
    throw new LivePublishError('This device is not registered as a camera.', 403, existing);
  }
  if (device.cameraId && device.cameraId !== camera.id) {
    throw new LivePublishError('This phone is registered to a different camera.', 403, existing);
  }
  if (!POSITIONS.has(camera.position) || !EDGES.has(camera.pictureEdge)) {
    throw new LivePublishError('Camera setup is not valid.', 400, existing);
  }
  const cameras = Array.isArray(existing.match.cameras) ? existing.match.cameras : [];
  if (!cameras.some((item) => item && typeof item === 'object' && 'id' in item && item.id === camera.id)) {
    throw new LivePublishError('That camera is not on this match.', 404, existing);
  }
  const nextCameras = cameras.map((item) => {
    if (!item || typeof item !== 'object' || !('id' in item) || item.id !== camera.id) return item;
    return { ...item, position: camera.position, pictureEdge: camera.pictureEdge };
  });
  return {
    ...store,
    devices: { ...store.devices, [deviceId]: { ...device, cameraId: camera.id, seenAt: updatedAt } },
    matches: {
      ...store.matches,
      [matchId]: {
        ...existing,
        updatedAt,
        revision: (existing.revision ?? 0) + 1,
        match: { ...existing.match, cameras: nextCameras },
      },
    },
  };
}

export function readLiveMatch(store: LiveStore, matchId: string, token: string) {
  const existing = store.matches[matchId];
  if (!existing || !token || !tokensMatch(existing.token, token)) {
    throw new LivePublishError('This link is invalid or the match has not synced to its host yet.', existing ? 403 : 404);
  }
  return existing;
}

const POSITIONS = new Set(['near-end', 'far-end', 'left-sideline', 'right-sideline']);
const EDGES = new Set(['bottom', 'top', 'left', 'right']);

function assertStatDevice(store: LiveStore, matchId: string, deviceId: string | undefined, existing: LiveRecord | undefined) {
  if (!deviceId) return;
  const device = store.devices[deviceId];
  if (!device || device.role !== 'stat' || device.matchId !== matchId) {
    throw new LivePublishError('This device is not designated for stat keeping.', 403, existing);
  }
}

function tokensMatch(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
