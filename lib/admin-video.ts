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

export type RallyRecord = {
  number: number;
  serve_ms: number;
  dead_ms: number;
  clip_start_ms: number;
  clip_end_ms: number;
};

export type TimingRecord = {
  first_serve_ms: number;
  set_end_ms: number;
  capture_speed: number;
  server_visible: boolean;
};

export type CourtMapRecord = { role?: string; status?: string; image_to_court?: unknown };

export type VideoAsset = {
  id: string;
  path: string;
  decision: string;
  flags?: string[];
  reasons?: { code: string; message: string }[];
  probe?: { duration_ms?: number; avg_fps?: number; width?: number; height?: number };
  timing?: TimingRecord;
  rally_index?: { review?: string; confirmed_at?: string; rallies?: RallyRecord[] };
  frame_list?: { row_count?: number; path?: string };
  court_maps?: CourtMapRecord[];
  player_marks?: unknown;
  touch_marks?: unknown;
  updated_at?: string;
};

export type ReadinessStep = { label: string; done: boolean; command: string; stale?: boolean };

export type Readiness = {
  markerReady: boolean;
  steps: ReadinessStep[];
};

/** The player and touch markers need a saved setup view that produced a court map (same test as players.setup_map). */
export function hasReadyCourtMap(asset: VideoAsset): boolean {
  return (asset.court_maps ?? []).some((map) => map.role === 'setup' && map.status === 'ready' && Boolean(map.image_to_court));
}

export type ReadinessExtras = {
  /** Modified time (ms since epoch) of the frame list file; null when the file is missing. Omit when unknown. */
  frameListBuiltAtMs?: number | null;
};

/**
 * A frame list is out of date once the rally sample changed after it was built: the sample went back to pending
 * (rallies were re-saved) or was confirmed again later than the file was written.
 */
export function frameListStale(asset: VideoAsset, extras: ReadinessExtras = {}): boolean {
  if (!asset.frame_list) return false;
  if (asset.rally_index?.review !== 'confirmed') return true;
  if (extras.frameListBuiltAtMs === undefined) return false;
  if (extras.frameListBuiltAtMs === null) return true;
  const confirmed = parseStamp(asset.rally_index?.confirmed_at);
  return confirmed !== null && confirmed > extras.frameListBuiltAtMs + 1000;
}

/** ISO time to ms since epoch; text with no zone is read as UTC, like the Python side. Null when it cannot be read. */
export function parseStamp(text: unknown): number | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const trimmed = text.trim();
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const value = Date.parse(zoned ? trimmed : `${trimmed}Z`);
  return Number.isNaN(value) ? null : value;
}

/** What the CLI still needs before mark/players/touches can open this recording. */
export function readiness(asset: VideoAsset, extras: ReadinessExtras = {}): Readiness {
  const quoted = `"${asset.path}"`;
  const confirmed = asset.rally_index?.review === 'confirmed';
  const stale = frameListStale(asset, extras);
  const steps: ReadinessStep[] = [
    { label: 'Accepted', done: asset.decision !== 'rejected', command: `register ${quoted} <flags>` },
    { label: 'Anchors', done: Boolean(asset.timing), command: `anchors ${quoted} --first-serve-sec S --set-end-sec E` },
    { label: 'Rallies', done: Boolean(asset.rally_index?.rallies?.length), command: `rallies ${quoted} --rally 17-27 ...` },
    { label: 'Confirmed', done: confirmed, command: `rallies ${quoted} --confirm` },
    { label: 'Frames', done: Boolean(asset.frame_list) && !stale, stale, command: `frames ${quoted}` },
    { label: 'Court map', done: hasReadyCourtMap(asset), command: 'mark (court marker)' },
    { label: 'Players', done: Boolean(asset.player_marks), command: 'players (player marker)' },
    { label: 'Touches', done: Boolean(asset.touch_marks), command: 'touches (touch marker)' },
  ];
  return { markerReady: confirmed && asset.decision !== 'rejected', steps };
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);

export type YouTubeLink = { kind: 'video' | 'playlist'; url: string };

/** Classify YouTube links: watch, youtu.be, shorts, live, embed (unlisted links look the same), or an explicit playlist page. */
export function youTubeLink(raw: string): YouTubeLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol) || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return parts[0] ? { kind: 'video', url: url.toString() } : null;
  if (parts[0] === 'playlist' && url.searchParams.get('list')) return { kind: 'playlist', url: url.toString() };
  if (parts[0] === 'watch' && url.searchParams.get('v')) return { kind: 'video', url: url.toString() };
  if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '') && parts[1]) return { kind: 'video', url: url.toString() };
  return null;
}

/** Argument vector for `python -m yt_dlp`. The URL goes after `--` so it can never be read as an option. */
export function ytDlpArgs(link: YouTubeLink, outputDir: string, opts: { ffmpeg: boolean }): string[] {
  const format = opts.ffmpeg ? 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b' : 'b[ext=mp4]/b';
  const args = [
    '-m', 'yt_dlp',
    '--ignore-config',
    link.kind === 'playlist' ? '--yes-playlist' : '--no-playlist',
    '-f', format,
    '--no-progress',
    '--no-overwrites',
    '--windows-filenames',
    '--paths', outputDir,
    '-o', '%(title).120B [%(id)s].%(ext)s',
    '--print', 'after_move:filepath',
  ];
  if (opts.ffmpeg) args.push('--merge-output-format', 'mp4');
  if (link.kind === 'playlist') args.push('--ignore-errors');
  args.push('--', link.url);
  return args;
}

/** Turn yt-dlp stderr into a short message, e.g. "Private video. Sign in if you've been granted access". */
export function ytDlpError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('ERROR:'));
  if (!lines.length) return stderr.trim().split(/\r?\n/).pop() || 'yt-dlp failed.';
  return lines.map((line) => line.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, '')).join('; ');
}
