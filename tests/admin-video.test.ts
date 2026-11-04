import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attestationArgs,
  isLocalAdminRequest,
  parseAttestation,
  parseUrlList,
  readiness,
  safeVideoName,
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
  const confirmed = readiness({ id: '1', path: 'a', decision: 'accepted', rally_index: { review: 'confirmed', rallies: [1] } });
  assert.equal(confirmed.markerReady, true);
});
