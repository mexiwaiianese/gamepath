export const MATCH_STORAGE_KEY = 'gamepath-live-match-v3';

export const CAMERA_POSITIONS = [
  ['near-end', 'Near end line'],
  ['far-end', 'Far end line'],
  ['left-sideline', 'Left sideline'],
  ['right-sideline', 'Right sideline'],
] as const;

export const PICTURE_EDGES = [
  ['bottom', 'Bottom'],
  ['top', 'Top'],
  ['left', 'Left'],
  ['right', 'Right'],
] as const;

export type CameraPosition = (typeof CAMERA_POSITIONS)[number][0];
export type PictureEdge = (typeof PICTURE_EDGES)[number][0];

export type MatchCamera = {
  id: string;
  position: CameraPosition;
  pictureEdge: PictureEdge;
};

const positionIds = new Set<string>(CAMERA_POSITIONS.map(([id]) => id));
const edgeIds = new Set<string>(PICTURE_EDGES.map(([id]) => id));

export function cameraPositionLabel(position: CameraPosition) {
  return CAMERA_POSITIONS.find(([id]) => id === position)?.[1] ?? 'Near end line';
}

export function camerasForCount(count: number, existing: MatchCamera[], ids: string[]) {
  const total = Math.min(CAMERA_POSITIONS.length, Math.max(1, Math.floor(count) || 1));
  const chosen: MatchCamera[] = [];
  const used = new Set<CameraPosition>();
  for (let index = 0; index < total; index += 1) {
    const prior = existing[index];
    const fallback = CAMERA_POSITIONS.map(([id]) => id).find((id) => !used.has(id)) ?? 'near-end';
    const position = prior && !used.has(prior.position) ? prior.position : fallback;
    used.add(position);
    chosen.push({
      id: prior?.id || ids[index] || `camera-${index + 1}`,
      position,
      pictureEdge: prior?.pictureEdge ?? 'bottom',
    });
  }
  return chosen;
}

export function cameraWithPosition(cameras: MatchCamera[], index: number, position: CameraPosition) {
  const next = cameras.map((camera) => ({ ...camera }));
  const previous = next[index]?.position;
  if (!previous) return cameras;
  const other = next.findIndex((camera, item) => item !== index && camera.position === position);
  next[index] = { ...next[index], position };
  if (other >= 0) next[other] = { ...next[other], position: previous };
  return next;
}

export function normalizeCamera(camera: Partial<MatchCamera> | undefined, fallbackId: string): MatchCamera {
  const position = camera && positionIds.has(camera.position ?? '') ? camera.position! : 'near-end';
  const pictureEdge = camera && edgeIds.has(camera.pictureEdge ?? '') ? camera.pictureEdge! : 'bottom';
  return { id: camera?.id || fallbackId, position, pictureEdge };
}

export function ensureCameras(matchId: string, cameras?: Partial<MatchCamera>[]) {
  if (!cameras?.length) return [normalizeCamera(undefined, `${matchId}-camera-1`)];
  return cameras.map((camera, index) => normalizeCamera(camera, `${matchId}-camera-${index + 1}`));
}

export function cameraSetupUrl(origin: string, matchId: string, cameraId: string, token?: string) {
  const url = new URL('/camera/', origin);
  url.searchParams.set('match', matchId);
  url.searchParams.set('camera', cameraId);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}

type StoredMatch = { id?: string; team?: string; opponent?: string; cameras?: Partial<MatchCamera>[] };

export function readStoredCamera(raw: string, matchId: string, cameraId: string) {
  const parsed = JSON.parse(raw) as { match?: StoredMatch; archivedMatches?: StoredMatch[] };
  const matches = [parsed.match, ...(parsed.archivedMatches ?? [])].filter((item): item is StoredMatch => !!item);
  const match = matches.find((item) => item.id === matchId);
  if (!match?.id) return null;
  const camera = ensureCameras(match.id, match.cameras).find((item) => item.id === cameraId);
  if (!camera) return null;
  return { team: match.team ?? 'Home', opponent: match.opponent ?? 'Opponent', camera };
}

export function writeStoredCamera(raw: string, matchId: string, camera: MatchCamera) {
  const parsed = JSON.parse(raw) as { match?: StoredMatch; archivedMatches?: StoredMatch[] };
  const apply = (match: StoredMatch | undefined) => {
    if (!match || match.id !== matchId) return match;
    const cameras = ensureCameras(match.id, match.cameras).map((item) => item.id === camera.id ? camera : item);
    return { ...match, cameras };
  };
  const inCurrent = parsed.match?.id === matchId;
  const inArchive = (parsed.archivedMatches ?? []).some((item) => item.id === matchId);
  if (!inCurrent && !inArchive) return null;
  return JSON.stringify({ ...parsed, match: apply(parsed.match), archivedMatches: (parsed.archivedMatches ?? []).map((item) => apply(item) ?? item) });
}
