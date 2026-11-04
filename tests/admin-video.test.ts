import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attestationArgs,
  isLocalAdminRequest,
  parseAttestation,
  parseUrlList,
  readiness,
  safeVideoName,
  youTubeLink,
  ytDlpArgs,
  ytDlpError,
} from '../lib/admin-video';

test('admin guard allows only development on loopback', () => {
  const ok = { nodeEnv: 'development', host: 'localhost:3000', origin: 'http://localhost:3000' };
  assert.equal(isLocalAdminRequest(ok), true);
  assert.equal(isLocalAdminRequest({ ...ok, host: '127.0.0.1:3000', origin: null }), true);
  assert.equal(isLocalAdminRequest({ ...ok, host: '[::1]:3000', origin: null }), true);
  assert.equal(isLocalAdminRequest({ ...ok, nodeEnv: 'production' }), false);
  assert.equal(isLocalAdminRequest({ ...ok, host: '192.168.1.5:3000' }), false);
  assert.equal(isLocalAdminRequest({ ...ok, origin: 'http://evil.example' }), false);
  assert.equal(isLocalAdminRequest({ ...ok, forwardedFor: '10.0.0.4' }), false);
});

test('attestation flags map to CLI args', () => {
  const parsed = parseAttestation({ fixedCamera: true, net: true, bogus: true, fullCourt: 'yes' });
  assert.deepEqual(attestationArgs(parsed), ['--fixed-camera', '--net']);
});

test('video names are made safe for Windows', () => {
  assert.equal(safeVideoName('..\\..\\evil:name?.MP4'), 'evil_name_.MP4');
  assert.equal(safeVideoName('clip'), 'clip.mp4');
  assert.equal(safeVideoName(''), 'video.mp4');
});

test('url list keeps http(s) lines only', () => {
  const { urls, invalid } = parseUrlList('https://a.test/x.mp4\r\n\n# note\nftp://b\nnot a url\nhttp://c.test/y');
  assert.deepEqual(urls, ['https://a.test/x.mp4', 'http://c.test/y']);
  assert.deepEqual(invalid, ['ftp://b', 'not a url']);
});

test('readiness reports remaining CLI steps', () => {
  const fresh = readiness({ id: '1', path: 'C:\\v\\a.mp4', decision: 'accepted' });
  assert.equal(fresh.markerReady, false);
  const confirmed = readiness({ id: '1', path: 'a', decision: 'accepted', rally_index: { review: 'confirmed', rallies: [{ number: 1, serve_ms: 1000, dead_ms: 2000, clip_start_ms: 0, clip_end_ms: 3500 }] } });
  assert.equal(confirmed.markerReady, true);
});

test('youtube links are detected', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=abc123&t=5',
    'https://youtu.be/abc123?si=x',
    'https://youtube.com/shorts/abc123',
    'https://m.youtube.com/watch?v=abc123&list=PL1',
    'https://www.youtube.com/live/abc123',
  ]) {
    assert.equal(youTubeLink(url)?.kind, 'video', url);
  }
  assert.equal(youTubeLink('https://www.youtube.com/playlist?list=PL1')?.kind, 'playlist');
  assert.equal(youTubeLink('https://example.com/watch?v=abc'), null);
  assert.equal(youTubeLink('https://www.youtube.com/@channel'), null);
  assert.equal(youTubeLink('https://cdn.test/video.mp4'), null);
});

test('yt-dlp args disable playlists and keep the URL after --', () => {
  const link = youTubeLink('https://www.youtube.com/watch?v=abc&list=PL1')!;
  const args = ytDlpArgs(link, 'C:\\v', { ffmpeg: false });
  assert.ok(args.includes('--no-playlist'));
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), link.url);
  assert.equal(args[args.indexOf('-f') + 1], 'b[ext=mp4]/b');
  assert.ok(!args.includes('--merge-output-format'));
  const list = ytDlpArgs(youTubeLink('https://www.youtube.com/playlist?list=PL1')!, 'C:\\v', { ffmpeg: true });
  assert.ok(list.includes('--yes-playlist'));
  assert.ok(list.includes('--merge-output-format'));
});

test('yt-dlp errors are shortened', () => {
  const stderr = 'WARNING: x\nERROR: [youtube] abc123: Private video. Sign in if you\'ve been granted access to this video\n';
  assert.equal(ytDlpError(stderr), "Private video. Sign in if you've been granted access to this video");
});
