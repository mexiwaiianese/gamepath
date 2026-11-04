// Pure helpers for the local admin video portal. No Node APIs here so tests and the client can import them.

export type TaggerId = 'mark' | 'players' | 'touches';

export type TaggerDef = {
  id: TaggerId;
  label: string;
  port: number;
  description: string;
  reviewModes?: readonly string[];
};

export const TAGGERS: readonly TaggerDef[] = [
  { id: 'mark', label: 'Court marker', port: 8765, description: 'Click court corners and lines on two stills.' },
  { id: 'players', label: 'Player marker', port: 8766, description: 'Box players on sampled frames.' },
  {
    id: 'touches',
    label: 'Touch marker',
    port: 8767,
    description: 'Mark ball touches per rally. Also reachable from the same Wi-Fi.',
    reviewModes: ['misses', 'reopen'],
  },
];

export function findTagger(id: unknown): TaggerDef | undefined {
  return TAGGERS.find((tagger) => tagger.id === id);
}

export const ATTESTATION_FLAGS = [
  { key: 'fixedCamera', flag: '--fixed-camera', label: 'Camera fixed for the whole set' },
  { key: 'fullCourt', flag: '--full-court', label: 'Full court in frame' },
  { key: 'baselines', flag: '--baselines', label: 'Both baselines in frame' },
  { key: 'net', flag: '--net', label: 'Net in frame' },
  { key: 'noMinors', flag: '--no-minors', label: 'Recording has no minors' },
] as const;

export type AttestationKey = (typeof ATTESTATION_FLAGS)[number]['key'];
export type Attestation = Partial<Record<AttestationKey, boolean>>;

export function attestationArgs(attestation: Attestation): string[] {
  return ATTESTATION_FLAGS.filter((item) => attestation[item.key] === true).map((item) => item.flag);
}

export function parseAttestation(value: unknown): Attestation {
  const result: Attestation = {};
  if (!value || typeof value !== 'object') return result;
  for (const item of ATTESTATION_FLAGS) {
    if ((value as Record<string, unknown>)[item.key] === true) result[item.key] = true;
  }
  return result;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function hostnameOf(hostHeader: string | null | undefined): string {
  if (!hostHeader) return '';
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0];
}

/** Development only, and only when the browser addressed this machine by a loopback name. */
export function isLocalAdminRequest(input: {
  nodeEnv: string | undefined;
  host: string | null;
  origin: string | null;
  forwardedFor?: string | null;
}): boolean {
  if (input.nodeEnv !== 'development') return false;
  if (!LOCAL_HOSTS.has(hostnameOf(input.host))) return false;
  if (input.forwardedFor) {
    const hops = input.forwardedFor.split(',').map((hop) => hop.trim());
    if (!hops.every((hop) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(hop))) return false;
  }
  if (input.origin) {
    try {
      if (!LOCAL_HOSTS.has(new URL(input.origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mkv', '.avi', '.webm', '.mts'];

export function safeVideoName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 160);
  const finalName = cleaned || 'video';
  const dot = finalName.lastIndexOf('.');
  const ext = dot > 0 ? finalName.slice(dot).toLowerCase() : '';
  return VIDEO_EXTENSIONS.includes(ext) ? finalName : `${finalName}.mp4`;
}

export function parseUrlList(text: string): { urls: string[]; invalid: string[] } {
  const urls: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const url = new URL(line);
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.push(url.toString());
      else invalid.push(line);
    } catch {
      invalid.push(line);
    }
  }
  return { urls, invalid };
}

export type VideoAsset = {
  id: string;
  path: string;
  decision: string;
  flags?: string[];
  reasons?: { code: string; message: string }[];
  timing?: unknown;
  rally_index?: { review?: string; rallies?: unknown[] };
  frame_list?: unknown;
  court_maps?: unknown[];
  player_marks?: unknown;
  touch_marks?: unknown;
  updated_at?: string;
};

export type Readiness = {
  markerReady: boolean;
  steps: { label: string; done: boolean; command: string }[];
};

/** What the CLI still needs before mark/players/touches can open this recording. */
export function readiness(asset: VideoAsset): Readiness {
  const quoted = `"${asset.path}"`;
  const confirmed = asset.rally_index?.review === 'confirmed';
  const steps = [
    { label: 'Accepted', done: asset.decision !== 'rejected', command: `register ${quoted} <flags>` },
    { label: 'Anchors', done: Boolean(asset.timing), command: `anchors ${quoted} --first-serve-sec S --set-end-sec E` },
    { label: 'Rallies', done: Boolean(asset.rally_index?.rallies?.length), command: `rallies ${quoted} --rally 17-27 ...` },
    { label: 'Confirmed', done: confirmed, command: `rallies ${quoted} --confirm` },
    { label: 'Frames', done: Boolean(asset.frame_list), command: `frames ${quoted}` },
    { label: 'Court map', done: Boolean(asset.court_maps?.length), command: 'mark (court marker)' },
    { label: 'Players', done: Boolean(asset.player_marks), command: 'players (player marker)' },
    { label: 'Touches', done: Boolean(asset.touch_marks), command: 'touches (touch marker)' },
  ];
  return { markerReady: confirmed && asset.decision !== 'rejected', steps };
}
