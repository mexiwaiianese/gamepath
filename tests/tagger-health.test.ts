import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import test from 'node:test';

import {
  classifyTagger,
  isHealthyReply,
  needsIndexFallback,
  parseLsofPids,
  parseNetstatListeners,
  parseSsListeners,
  selectKillable,
  type ProbeResult,
} from '../lib/tagger-health';
import { probeHttp, probeTagger } from '../lib/tagger-process';

const healthy = (tagger: string): ProbeResult => ({
  kind: 'http',
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, service: 'gamepath-marker', tagger }),
});
const html = (title: string, status = 200): ProbeResult => ({ kind: 'http', status, contentType: 'text/html; charset=utf-8', body: `<html><head><title>${title}</title></head></html>` });

test('classifyTagger: running, stuck and stopped', () => {
  assert.equal(classifyTagger('mark', healthy('mark')), 'running');
  assert.equal(classifyTagger('mark', { kind: 'closed' }), 'stopped');
  assert.equal(classifyTagger('mark', { kind: 'no-response' }), 'stuck');
  // /health from a different tagger or a different service is not "this marker"
  assert.equal(classifyTagger('mark', healthy('players')), 'stuck');
  assert.equal(classifyTagger('mark', { kind: 'http', status: 200, contentType: 'application/json', body: '{"ok":true}' }), 'stuck');
  assert.equal(classifyTagger('mark', { kind: 'http', status: 200, contentType: 'text/plain', body: 'nope' }), 'stuck');
  assert.equal(classifyTagger('mark', { kind: 'http', status: 500, contentType: 'application/json', body: '{}' }), 'stuck');
});

test('classifyTagger: older markers without /health are recognised by their index page', () => {
  assert.equal(classifyTagger('mark', html('Not found', 404), html('GamePath court setup')), 'running');
  assert.equal(classifyTagger('mark', html('Not found', 404), html('Some other app')), 'stuck');
  assert.equal(classifyTagger('mark', html('Not found', 404), { kind: 'no-response' }), 'stuck');
  assert.equal(classifyTagger('mark', html('Not found', 404), html('GamePath court setup', 500)), 'stuck');
});

test('needsIndexFallback only when something spoke HTTP without a healthy /health', () => {
  assert.equal(needsIndexFallback('mark', html('x', 404)), true);
  assert.equal(needsIndexFallback('mark', healthy('mark')), false);
  assert.equal(needsIndexFallback('mark', { kind: 'closed' }), false);
  assert.equal(needsIndexFallback('mark', { kind: 'no-response' }), false);
  assert.equal(isHealthyReply('mark', healthy('mark')), true);
});

const NETSTAT = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1040
  TCP    0.0.0.0:8765           0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:8766         0.0.0.0:0              LISTENING       5150
  TCP    [::]:8766              [::]:0                 LISTENING       5150
  TCP    [::]:8767              [::]:0                 LISTENING       6001
  TCP    127.0.0.1:8765         127.0.0.1:50321        ESTABLISHED     4242
  TCP    127.0.0.1:50321        127.0.0.1:8765         ESTABLISHED     9999
  TCP    192.168.1.20:8767      0.0.0.0:0              LISTENING       7777
  TCP    0.0.0.0:18765          0.0.0.0:0              LISTENING       1234
  TCP    0.0.0.0:87650          0.0.0.0:0              LISTENING       1235
`;

test('parseNetstatListeners picks only LISTENING sockets on the exact port', () => {
  assert.deepEqual(parseNetstatListeners(NETSTAT, 8765), [4242]);
  assert.deepEqual(parseNetstatListeners(NETSTAT, 8766), [5150]);
  assert.deepEqual(parseNetstatListeners(NETSTAT, 8767), [6001]); // not the LAN-address listener
  assert.deepEqual(parseNetstatListeners(NETSTAT, 8000), []);
  assert.deepEqual(parseNetstatListeners('', 8765), []);
});

test('parseNetstatListeners handles CRLF and localized state words', () => {
  const german = '  TCP    0.0.0.0:8765           0.0.0.0:0              ABHÖREN         321\r\n  TCP    127.0.0.1:8765  127.0.0.1:50000  HERGESTELLT  322\r\n';
  assert.deepEqual(parseNetstatListeners(german, 8765), [321]);
});

test('parseLsofPids reads one PID per line and ignores noise', () => {
  assert.deepEqual(parseLsofPids('1234\n5678\n'), [1234, 5678]);
  assert.deepEqual(parseLsofPids('1234\n1234\n'), [1234]);
  assert.deepEqual(parseLsofPids('lsof: WARNING: can\'t stat() fuse\n42\n'), [42]);
  assert.deepEqual(parseLsofPids(''), []);
});

test('parseSsListeners reads pid= from ss -ltnp', () => {
  const ss = `State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      5          127.0.0.1:8765      0.0.0.0:*     users:(("python",pid=4321,fd=3))
LISTEN 0      5            0.0.0.0:8767      0.0.0.0:*     users:(("python",pid=4400,fd=3))
LISTEN 0      5               [::]:8766         [::]:*     users:(("node",pid=77,fd=20),("node",pid=78,fd=20))
LISTEN 0      5       192.168.1.2:8765      0.0.0.0:*     users:(("other",pid=1,fd=3))
LISTEN 0      5            0.0.0.0:18765     0.0.0.0:*     users:(("x",pid=9,fd=3))
ESTAB  0      0          127.0.0.1:8765    127.0.0.1:41000 users:(("python",pid=4321,fd=5))
`;
  assert.deepEqual(parseSsListeners(ss, 8765), [4321]);
  assert.deepEqual(parseSsListeners(ss, 8767), [4400]);
  assert.deepEqual(parseSsListeners(ss, 8766), [77, 78]);
});

test('selectKillable never returns the portal, its parent, or system PIDs', () => {
  assert.deepEqual(selectKillable([100, 200, 300], [200, 300]), { killable: [100], refused: [200, 300] });
  assert.deepEqual(selectKillable([4, 0, 1, 5000], [undefined]), { killable: [5000], refused: [4, 0, 1] });
  assert.deepEqual(selectKillable([], [1]), { killable: [], refused: [] });
});

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)));
}

test('probeTagger against real sockets: stopped, stuck (silent), stuck (garbage), stuck (other app), running', async () => {
  // stopped: grab a free port, then close it
  const spare = net.createServer();
  const freePort = await listen(spare);
  await new Promise((resolve) => spare.close(resolve));
  assert.equal(await probeTagger('mark', freePort, 500), 'stopped');

  // stuck: accepts the connection and never answers
  const silent = net.createServer(() => {});
  const silentPort = await listen(silent);
  const started = Date.now();
  assert.equal(await probeTagger('mark', silentPort, 300), 'stuck');
  assert.ok(Date.now() - started < 1500);

  // stuck: accepts and immediately closes (what ERR_EMPTY_RESPONSE looks like)
  const closer = net.createServer((socket) => socket.destroy());
  const closerPort = await listen(closer);
  assert.deepEqual(await probeHttp(closerPort, '/health', 500), { kind: 'no-response' });
  assert.equal(await probeTagger('mark', closerPort, 500), 'stuck');

  // stuck: speaks something that is not HTTP
  const garbage = net.createServer((socket) => socket.end('SSH-2.0-nope\r\n'));
  const garbagePort = await listen(garbage);
  assert.equal(await probeTagger('mark', garbagePort, 500), 'stuck');

  // stuck: a different web app
  const other = http.createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Other</title>'));
  const otherPort = await listen(other);
  assert.equal(await probeTagger('mark', otherPort, 500), 'stuck');

  // running: new marker with /health
  const marker = http.createServer((req, res) => {
    if (req.url === '/health') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, service: 'gamepath-marker', tagger: 'mark' }));
    else res.writeHead(404).end('Not found');
  });
  const markerPort = await listen(marker);
  assert.equal(await probeTagger('mark', markerPort, 500), 'running');
  assert.equal(await probeTagger('players', markerPort, 500), 'stuck');

  // running: old marker with only an index page
  const legacy = http.createServer((req, res) => {
    if (req.url === '/') res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>GamePath court setup</title>');
    else res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  });
  const legacyPort = await listen(legacy);
  assert.equal(await probeTagger('mark', legacyPort, 500), 'running');

  for (const server of [silent, closer, garbage]) server.close();
  for (const server of [other, marker, legacy]) {
    server.closeAllConnections();
    server.close();
  }
});
