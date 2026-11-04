// Pure helpers for the portal's per-video "Prepare" panel: validation that mirrors the Python CLI
// (services/video/gamepath_video/anchors.py, rallies.py, frames.py, marker.py), CLI argument vectors,
// HTTP Range parsing, and which video each marker opens by default. No Node APIs, so tests and the client can import it.

import { hasReadyCourtMap, parseStamp, type TaggerId, type TimingRecord, type VideoAsset } from './admin-video';

/** Same values as services/video/gamepath_video/contract.py. A rally clip opens PREROLL before the serve and closes POSTROLL after the dead ball. */
export const PREROLL_MS = 1000;
export const POSTROLL_MS = 1500;
/** The court marker's setup view uses rally 1 and its check view uses rally 9 (or the last one if there are fewer). */
export const CHECK_RALLY_NUMBER = 9;

export type PipelineStep = 'anchors' | 'rallies' | 'confirm' | 'frames';
export const PIPELINE_STEPS: readonly PipelineStep[] = ['anchors', 'rallies', 'confirm', 'frames'];

export function isPipelineStep(value: unknown): value is PipelineStep {
  return PIPELINE_STEPS.includes(value as PipelineStep);
}

// ---------- numbers ----------

/** Seconds with millisecond precision and never an exponent, e.g. 12.5 -> "12.500". */
export function secondsText(seconds: number): string {
  return (Math.round(seconds * 1000) / 1000).toFixed(3);
}

/** A plain non-negative decimal such as "17", "17.5" or ".5". No exponent, sign or units. Null when it is not one. */
export function parseSeconds(text: string): number | null {
  const trimmed = text.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const toMs = (seconds: number) => Math.round(seconds * 1000);

/** m:ss.mmm for display. */
export function clockText(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.round(safe * 1000);
  const minutes = Math.floor(total / 60000);
  const rest = total - minutes * 60000;
  return `${minutes}:${(rest / 1000).toFixed(3).padStart(6, '0')}`;
}

// ---------- anchors ----------

export type AnchorsInput = { firstServe: string; setEnd: string; captureSpeed: string; serverOffCamera: boolean };
export type AnchorsValue = { firstServeSec: number; setEndSec: number; captureSpeed: number; serverOffCamera: boolean };

/** Mirrors anchors.build_timing: set end after first serve, inside the file, capture speed above zero. */
export function validateAnchors(input: AnchorsInput, durationMs: number | null | undefined): { errors: string[]; value?: AnchorsValue } {
  const errors: string[] = [];
  const first = parseSeconds(input.firstServe);
  const end = parseSeconds(input.setEnd);
  const speed = parseSeconds(input.captureSpeed);
  if (first === null) errors.push('First serve must be a number of seconds, for example 17.5.');
  if (end === null) errors.push('Set end must be a number of seconds, for example 2539.');
  if (speed === null || speed <= 0) errors.push('Capture speed must be greater than zero (1 is real time).');
  if (first !== null && end !== null) {
    if (toMs(end) <= toMs(first)) errors.push('Set end must be after the first serve.');
    else if (durationMs && toMs(end) > durationMs) errors.push(`Set end is ${toMs(end)} ms and the file is ${durationMs} ms.`);
  }
  if (errors.length || first === null || end === null || speed === null) return { errors };
  return { errors, value: { firstServeSec: first, setEndSec: end, captureSpeed: speed, serverOffCamera: input.serverOffCamera } };
}

/** Arguments after `python -m gamepath_video`. The `--name=value` form keeps every value out of option parsing. */
export function anchorsArgs(videoPath: string, value: AnchorsValue): string[] {
  const args = [
    'anchors',
    videoPath,
    `--first-serve-sec=${secondsText(value.firstServeSec)}`,
    `--set-end-sec=${secondsText(value.setEndSec)}`,
    `--capture-speed=${String(value.captureSpeed)}`,
  ];
  if (value.serverOffCamera) args.push('--server-off-camera');
  return args;
}

// ---------- rallies ----------

export type RallySpan = { serve: number | null; dead: number | null };

export type RallyCheck = {
  /** One entry per input row: the first problem with that rally, or null. */
  rows: (string | null)[];
  /** Problems with the list as a whole. */
  general: string[];
  ok: boolean;
};

/**
 * Mirrors rallies.build_rally_index: at least one rally; each rally ends after it starts; starts at or after the first
 * serve; ends by the set end; starts at or after the previous rally ends (so the list must be in order and not overlap);
 * and its clip (dead ball + 1.5 s) must not run past the end of the file. The CLI has no maximum.
 */
export function validateRallies(spans: RallySpan[], timing: Pick<TimingRecord, 'first_serve_ms' | 'set_end_ms'> | null | undefined, durationMs: number | null | undefined): RallyCheck {
  const general: string[] = [];
  const rows: (string | null)[] = spans.map(() => null);
  if (!spans.length) general.push('Add at least one rally.');
  let previousDead: number | null = null;
  spans.forEach((span, i) => {
    const number = i + 1;
    if (span.serve === null || span.dead === null) {
      rows[i] = `Rally ${number} needs both a serve time and a dead-ball time.`;
      previousDead = null;
      return;
    }
    const serve = toMs(span.serve);
    const dead = toMs(span.dead);
    if (serve < 0 || dead <= serve) rows[i] = `Rally ${number} ends at or before it starts.`;
    else if (timing && serve < timing.first_serve_ms) rows[i] = `Rally ${number} starts before the first serve of the set (${secondsText(timing.first_serve_ms / 1000)} s).`;
    else if (timing && dead > timing.set_end_ms) rows[i] = `Rally ${number} ends after the set (${secondsText(timing.set_end_ms / 1000)} s).`;
    else if (previousDead !== null && serve < previousDead) rows[i] = `Rally ${number} starts before rally ${number - 1} ends.`;
    else if (durationMs && dead + POSTROLL_MS > durationMs) rows[i] = `Rally ${number} clip runs past the end of the file (the clip closes ${POSTROLL_MS / 1000} s after the dead ball).`;
    previousDead = dead;
  });
  return { rows, general, ok: !general.length && rows.every((row) => row === null) };
}

export function ralliesArgs(videoPath: string, spans: { serve: number; dead: number }[]): string[] {
  const args = ['rallies', videoPath];
  for (const span of spans) args.push('--rally', `${secondsText(span.serve)}-${secondsText(span.dead)}`);
  return args;
}

export function confirmArgs(videoPath: string): string[] {
  return ['rallies', videoPath, '--confirm'];
}

export function framesArgs(videoPath: string): string[] {
  return ['frames', videoPath];
}

export function rallyClip(serveSec: number, deadSec: number): { startSec: number; endSec: number } {
  return { startSec: Math.max(0, toMs(serveSec) - PREROLL_MS) / 1000, endSec: (toMs(deadSec) + POSTROLL_MS) / 1000 };
}

/** The sentence the Rallies step shows about how many rallies the CLI expects. */
export const RALLY_COUNT_RULE =
  `The CLI needs at least 1 rally and has no maximum. The court marker's setup view uses rally 1 and its check view uses rally ${CHECK_RALLY_NUMBER} (or the last one), so ${CHECK_RALLY_NUMBER} or more gives a real second view.`;

// ---------- step gates and warnings ----------

/** Why this step cannot run yet, or null. The server enforces the same order the portal shows. */
export function stepGate(asset: VideoAsset, step: PipelineStep): string | null {
  if (asset.decision === 'rejected') return 'This video was rejected by the capture profile, so it cannot be prepared.';
  if (step === 'anchors') return null;
  if (!asset.timing) return 'Save the anchors first.';
  if (step === 'rallies') return null;
  if (!asset.rally_index?.rallies?.length) return 'Save the rallies first.';
  if (step === 'confirm') return null;
  if (asset.rally_index.review !== 'confirmed') return 'Confirm the rallies first.';
  return null;
}

/** What re-running a step overwrites or leaves behind. Empty when nothing downstream exists. */
export function invalidationWarnings(asset: VideoAsset, step: PipelineStep, proposed?: { anchors?: AnchorsValue }): string[] {
  const warnings: string[] = [];
  const rallies = asset.rally_index?.rallies ?? [];
  if (step === 'anchors' && rallies.length) {
    const next = proposed?.anchors;
    const outside = next ? rallies.filter((r) => r.serve_ms < toMs(next.firstServeSec) || r.dead_ms > toMs(next.setEndSec)).length : 0;
    warnings.push(
      outside
        ? `${outside} of the ${rallies.length} saved rallies fall outside the new first serve / set end. The CLI does not re-check saved rallies, so fix and re-save them afterwards.`
        : 'Saved rallies are not re-checked against new anchors. Review them afterwards.',
    );
  }
  if (step === 'rallies') {
    if (asset.rally_index?.review === 'confirmed') warnings.push('Saving rallies un-confirms the sample. You will need to confirm again.');
    if (asset.frame_list) warnings.push('The frame list was built from the old rallies. It stays on disk until you rebuild it.');
    if (asset.player_marks) warnings.push('Player marks are stored per rally number and may no longer line up with the new rallies.');
    if (asset.touch_marks) warnings.push('Touch marks are stored per rally number and may no longer line up with the new rallies.');
  }
  if (step === 'confirm' && asset.frame_list) warnings.push('The frame list is out of date after a new confirmation. Rebuild it.');
  if (step === 'frames' && asset.frame_list) warnings.push('This replaces the existing frame list.');
  return warnings;
}

// ---------- markers ----------

/** Short reason a video cannot open in a tagger yet, shown in the dropdown as "game2.mp4 (needs anchors)". Null when it can. */
export function markerBlocker(asset: VideoAsset, tagger: TaggerId, fileExists: boolean): string | null {
  if (asset.decision === 'rejected') return 'rejected by capture profile';
  if (!asset.timing) return 'needs anchors';
  if (!asset.rally_index?.rallies?.length) return 'needs rallies';
  if (asset.rally_index.review !== 'confirmed') return 'needs confirmation';
  if (!fileExists) return 'file missing';
  if (tagger !== 'mark' && !hasReadyCourtMap(asset)) return 'needs court map';
  return null;
}

/**
 * Mirror of marker.choose_asset with no selector, for the dropdown label. `assets` must be in registry order.
 * Most recently confirmed (rally_index.confirmed_at; unstamped counts as oldest; ties go to the later registry entry),
 * preferring assets with a frame list for the court marker and assets with a saved court map for players and touches.
 */
export function defaultAssetId(tagger: TaggerId, assets: VideoAsset[]): string | null {
  const confirmed = assets.filter((asset) => asset.rally_index?.review === 'confirmed');
  if (!confirmed.length) return null;
  const preferred = tagger === 'mark' ? confirmed.filter((asset) => asset.frame_list) : confirmed.filter(hasReadyCourtMap);
  const pool = preferred.length ? preferred : confirmed;
  let best = pool[0];
  let bestStamp = parseStamp(best.rally_index?.confirmed_at) ?? -Infinity;
  for (const asset of pool.slice(1)) {
    const stamp = parseStamp(asset.rally_index?.confirmed_at) ?? -Infinity;
    if (stamp >= bestStamp) {
      best = asset;
      bestStamp = stamp;
    }
  }
  return best.id;
}

// ---------- HTTP Range ----------

export type ByteRange = { kind: 'full' } | { kind: 'range'; start: number; end: number } | { kind: 'unsatisfiable' };

/** Parse a single `Range: bytes=...` header against a file of `size` bytes. Anything unparseable or multi-range is served whole. */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange {
  if (!header) return { kind: 'full' };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return { kind: 'full' };
  const [, from, to] = match;
  if (from === '' && to === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  if (from === '') {
    const suffix = Number(to);
    if (suffix <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || end < start) return { kind: 'unsatisfiable' };
  return { kind: 'range', start, end };
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mts': 'video/mp2t',
};

export function videoMime(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot >= 0 && MIME[fileName.slice(dot).toLowerCase()]) || 'application/octet-stream';
}
