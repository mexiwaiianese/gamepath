import assert from 'node:assert/strict';
import test from 'node:test';

import { frameListStale, hasReadyCourtMap, readiness, type VideoAsset } from '../lib/admin-video';
import {
  anchorsArgs,
  clockText,
  confirmArgs,
  defaultAssetId,
  framesArgs,
  invalidationWarnings,
  markerBlocker,
  parseByteRange,
  parseSeconds,
  ralliesArgs,
  rallyClip,
  secondsText,
  stepGate,
  validateAnchors,
  validateRallies,
  videoMime,
} from '../lib/admin-video-pipeline';

const timing = { first_serve_ms: 17_000, set_end_ms: 2_539_000, capture_speed: 1, server_visible: true };
const rally = (number: number, serve: number, dead: number) => ({ number, serve_ms: serve * 1000, dead_ms: dead * 1000, clip_start_ms: serve * 1000 - 1000, clip_end_ms: dead * 1000 + 1500 });
const map = { role: 'setup', status: 'ready', image_to_court: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

function asset(over: Partial<VideoAsset> & { id: string }): VideoAsset {
  return { path: `/v/${over.id}.mp4`, decision: 'accepted', probe: { duration_ms: 3_000_000 }, ...over };
}

test('seconds are parsed and printed without exponents', () => {
  assert.equal(parseSeconds(' 17.5 '), 17.5);
  assert.equal(parseSeconds('.5'), 0.5);
  assert.equal(parseSeconds('1e3'), null);
  assert.equal(parseSeconds('-1'), null);
  assert.equal(parseSeconds(''), null);
  assert.equal(parseSeconds('abc'), null);
  assert.equal(secondsText(0.0000001), '0.000');
  assert.equal(secondsText(17), '17.000');
  assert.equal(secondsText(12.3456), '12.346');
  assert.equal(clockText(83.0456), '1:23.046');
  assert.equal(clockText(-4), '0:00.000');
});

test('anchors follow anchors.build_timing', () => {
  const ok = validateAnchors({ firstServe: '17', setEnd: '2539', captureSpeed: '1', serverOffCamera: false }, 2_562_933);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value?.setEndSec, 2539);
  assert.match(validateAnchors({ firstServe: '30', setEnd: '30', captureSpeed: '1', serverOffCamera: false }, 60_000).errors[0], /after the first serve/);
  assert.match(validateAnchors({ firstServe: '1', setEnd: '61', captureSpeed: '1', serverOffCamera: false }, 60_000).errors[0], /file is 60000 ms/);
  assert.match(validateAnchors({ firstServe: '1', setEnd: '5', captureSpeed: '0', serverOffCamera: false }, 60_000).errors[0], /greater than zero/);
  assert.equal(validateAnchors({ firstServe: '', setEnd: '5', captureSpeed: '1', serverOffCamera: false }, 60_000).value, undefined);
});

test('anchors arguments are an array with the values bound to their options', () => {
  const args = anchorsArgs('C:\\v\\a b.mp4', { firstServeSec: 17, setEndSec: 2539.5, captureSpeed: 3, serverOffCamera: true });
  assert.deepEqual(args, ['anchors', 'C:\\v\\a b.mp4', '--first-serve-sec=17.000', '--set-end-sec=2539.500', '--capture-speed=3', '--server-off-camera']);
  assert.ok(!anchorsArgs('x', { firstServeSec: 1, setEndSec: 2, captureSpeed: 1, serverOffCamera: false }).includes('--server-off-camera'));
});

test('rally validation matches rallies.build_rally_index', () => {
  const check = (spans: [number | null, number | null][], duration = 3_000_000) => validateRallies(spans.map(([serve, dead]) => ({ serve, dead })), timing, duration);
  assert.equal(check([[17, 27], [27, 40], [193, 204]]).ok, true, 'touching rallies are allowed');
  assert.match(check([]).general[0], /at least one/i);
  assert.match(check([[17, 27], [20, 30]]).rows[1] ?? '', /starts before rally 1 ends/);
  assert.match(check([[30, 30]]).rows[0] ?? '', /ends at or before it starts/);
  assert.match(check([[16.9, 20]]).rows[0] ?? '', /before the first serve/);
  assert.match(check([[2530, 2540]]).rows[0] ?? '', /ends after the set/);
  assert.match(check([[40, 50], [17, 27]]).rows[1] ?? '', /starts before rally 1 ends/, 'out of order is an overlap');
  assert.match(check([[17, null]]).rows[0] ?? '', /needs both/);
  assert.match(check([[17, 27]], 28_000).rows[0] ?? '', /past the end of the file/);
  assert.equal(check([[17, 27]], 28_500).ok, true);
  assert.equal(validateRallies([{ serve: 1, dead: 2 }], null, 0).ok, true);
});

test('rally and frame arguments use arrays and plain decimals', () => {
  assert.deepEqual(ralliesArgs('/v/a.mp4', [{ serve: 17, dead: 27.25 }, { serve: 30, dead: 41 }]), ['rallies', '/v/a.mp4', '--rally', '17.000-27.250', '--rally', '30.000-41.000']);
  assert.deepEqual(confirmArgs('/v/a.mp4'), ['rallies', '/v/a.mp4', '--confirm']);
  assert.deepEqual(framesArgs('/v/a.mp4'), ['frames', '/v/a.mp4']);
  assert.deepEqual(rallyClip(17, 27), { startSec: 16, endSec: 28.5 });
  assert.equal(rallyClip(0.4, 2).startSec, 0);
});

test('steps unlock in order and a rejected video unlocks nothing', () => {
  const fresh = asset({ id: 'a' });
  assert.equal(stepGate(fresh, 'anchors'), null);
  assert.match(stepGate(fresh, 'rallies') ?? '', /anchors/);
  const anchored = asset({ id: 'a', timing });
  assert.equal(stepGate(anchored, 'rallies'), null);
  assert.match(stepGate(anchored, 'confirm') ?? '', /rallies/);
  const sampled = asset({ id: 'a', timing, rally_index: { review: 'pending', rallies: [rally(1, 17, 27)] } });
  assert.equal(stepGate(sampled, 'confirm'), null);
  assert.match(stepGate(sampled, 'frames') ?? '', /Confirm/);
  const confirmed = asset({ id: 'a', timing, rally_index: { review: 'confirmed', rallies: [rally(1, 17, 27)] } });
  assert.equal(stepGate(confirmed, 'frames'), null);
  assert.match(stepGate({ ...confirmed, decision: 'rejected' }, 'anchors') ?? '', /rejected/);
});

test('editing earlier steps warns about what it invalidates', () => {
  const done = asset({
    id: 'a',
    timing,
    rally_index: { review: 'confirmed', rallies: [rally(1, 17, 27), rally(2, 100, 110)] },
    frame_list: { row_count: 10 },
    player_marks: {},
    touch_marks: {},
  });
  const rallyWarnings = invalidationWarnings(done, 'rallies').join(' ');
  assert.match(rallyWarnings, /un-confirms/);
  assert.match(rallyWarnings, /frame list/);
  assert.match(rallyWarnings, /Player marks/);
  assert.match(rallyWarnings, /Touch marks/);
  const narrowed = invalidationWarnings(done, 'anchors', { anchors: { firstServeSec: 50, setEndSec: 2000, captureSpeed: 1, serverOffCamera: false } });
  assert.match(narrowed[0], /1 of the 2 saved rallies fall outside/);
  assert.deepEqual(invalidationWarnings(asset({ id: 'b' }), 'anchors'), []);
  assert.deepEqual(invalidationWarnings(asset({ id: 'b', timing }), 'rallies'), []);
});

test('a frame list is stale once the rally sample changed after it was built', () => {
  const built = Date.parse('2026-11-02T12:00:00Z');
  const base = asset({ id: 'a', timing, rally_index: { review: 'confirmed', confirmed_at: '2026-11-02T11:00:00+00:00', rallies: [rally(1, 17, 27)] }, frame_list: { row_count: 3, path: '/f.jsonl' } });
  assert.equal(frameListStale(base, { frameListBuiltAtMs: built }), false);
  assert.equal(frameListStale({ ...base, rally_index: { ...base.rally_index, confirmed_at: '2026-11-02T13:00:00.123456+00:00' } }, { frameListBuiltAtMs: built }), true);
  assert.equal(frameListStale({ ...base, rally_index: { ...base.rally_index, review: 'pending' } }, { frameListBuiltAtMs: built }), true);
  assert.equal(frameListStale(base, { frameListBuiltAtMs: null }), true);
  assert.equal(frameListStale(asset({ id: 'n' }), { frameListBuiltAtMs: null }), false);
  const steps = readiness(base, { frameListBuiltAtMs: null }).steps;
  const frames = steps.find((step) => step.label === 'Frames');
  assert.equal(frames?.done, false);
  assert.equal(frames?.stale, true);
});

test('court map counts only when the setup view produced a map', () => {
  assert.equal(hasReadyCourtMap(asset({ id: 'a', court_maps: [map] })), true);
  assert.equal(hasReadyCourtMap(asset({ id: 'a', court_maps: [{ role: 'setup', status: 'invalid' }] })), false);
  assert.equal(hasReadyCourtMap(asset({ id: 'a', court_maps: [{ ...map, role: 'check' }] })), false);
  const steps = readiness(asset({ id: 'a', court_maps: [{ role: 'setup', status: 'invalid' }] })).steps;
  assert.equal(steps.find((step) => step.label === 'Court map')?.done, false);
});

test('marker dropdown reasons name the first missing step', () => {
  const rallies = [rally(1, 17, 27)];
  assert.equal(markerBlocker(asset({ id: 'a' }), 'mark', true), 'needs anchors');
  assert.equal(markerBlocker(asset({ id: 'a', timing }), 'mark', true), 'needs rallies');
  assert.equal(markerBlocker(asset({ id: 'a', timing, rally_index: { review: 'pending', rallies } }), 'mark', true), 'needs confirmation');
  const confirmed = asset({ id: 'a', timing, rally_index: { review: 'confirmed', rallies } });
  assert.equal(markerBlocker(confirmed, 'mark', true), null);
  assert.equal(markerBlocker(confirmed, 'mark', false), 'file missing');
  assert.equal(markerBlocker(confirmed, 'players', true), 'needs court map');
  assert.equal(markerBlocker(confirmed, 'touches', true), 'needs court map');
  assert.equal(markerBlocker({ ...confirmed, court_maps: [map] }, 'touches', true), null);
  assert.match(markerBlocker({ ...confirmed, decision: 'rejected' }, 'mark', true) ?? '', /rejected/);
});

test('default marker video is the most recently confirmed one (mirrors marker.choose_asset)', () => {
  const rallies = [rally(1, 17, 27)];
  const at = (id: string, confirmedAt?: string, extra: Partial<VideoAsset> = {}) =>
    asset({ id, timing, rally_index: { review: 'confirmed', confirmed_at: confirmedAt, rallies }, ...extra });
  assert.equal(defaultAssetId('mark', []), null);
  assert.equal(defaultAssetId('mark', [asset({ id: 'x', timing, rally_index: { review: 'pending', rallies } })]), null);
  const registry = [
    at('old', '2026-10-01T12:00:00+00:00', { frame_list: { row_count: 1 } }),
    at('new', '2026-11-02T12:00:00+00:00', { frame_list: { row_count: 1 } }),
    at('registered-last', '2026-10-15T12:00:00+00:00', { frame_list: { row_count: 1 } }),
  ];
  assert.equal(defaultAssetId('mark', registry), 'new');
  assert.equal(defaultAssetId('mark', [at('a', undefined, { frame_list: { row_count: 1 } }), at('b', undefined, { frame_list: { row_count: 1 } })]), 'b', 'registry order is the fallback');
  assert.equal(defaultAssetId('mark', [at('stamped', '2026-11-01T00:00:00+00:00'), at('legacy')]), 'stamped');
  assert.equal(defaultAssetId('mark', [at('newer', '2026-11-01T23:00:00-07:00'), at('later', '2026-11-02T01:00:00+00:00')]), 'newer');
  assert.equal(defaultAssetId('mark', [at('framed', '2026-10-01T00:00:00+00:00', { frame_list: { row_count: 1 } }), at('newer', '2026-11-01T00:00:00+00:00')]), 'framed');
  const mapped = [at('mapped', '2026-10-01T00:00:00+00:00', { court_maps: [map] }), at('newer', '2026-11-01T00:00:00+00:00')];
  assert.equal(defaultAssetId('mark', mapped), 'newer');
  assert.equal(defaultAssetId('players', mapped), 'mapped');
  assert.equal(defaultAssetId('touches', [at('a', '2026-10-01T00:00:00+00:00'), at('b', '2026-11-01T00:00:00+00:00')]), 'b');
});

test('range requests are parsed like a file server would', () => {
  assert.deepEqual(parseByteRange(null, 1000), { kind: 'full' });
  assert.deepEqual(parseByteRange('bytes=0-99', 1000), { kind: 'range', start: 0, end: 99 });
  assert.deepEqual(parseByteRange('bytes=900-', 1000), { kind: 'range', start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=900-5000', 1000), { kind: 'range', start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-100', 1000), { kind: 'range', start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=-5000', 1000), { kind: 'range', start: 0, end: 999 });
  assert.deepEqual(parseByteRange('bytes=1000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=50-10', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseByteRange('bytes=0-1,5-9', 1000), { kind: 'full' });
  assert.deepEqual(parseByteRange('items=0-1', 1000), { kind: 'full' });
  assert.deepEqual(parseByteRange('bytes=0-0', 0), { kind: 'unsatisfiable' });
});

test('video mime types come from the extension', () => {
  assert.equal(videoMime('C:\\v\\Game 1.MP4'), 'video/mp4');
  assert.equal(videoMime('a.mov'), 'video/quicktime');
  assert.equal(videoMime('a.xyz'), 'application/octet-stream');
});
