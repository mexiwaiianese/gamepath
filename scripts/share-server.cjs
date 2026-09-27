const { createServer } = require('node:http');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const port = Number(process.env.GAMEPATH_SHARE_PORT || 3031);
const dataDirectory = path.join(process.cwd(), '.gamepath', 'shared-matches');
const maxBodyBytes = 2 * 1024 * 1024;
const commonHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0',
};

function sendJson(response, status, body) {
  response.writeHead(status, { ...commonHeaders, 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function validId(value) {
  return /^[a-z0-9-]{1,100}$/i.test(value);
}

function tokenMatches(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected.toLowerCase()), Buffer.from(actual.toLowerCase()));
}

async function readRecord(id) {
  try {
    return JSON.parse(await readFile(path.join(dataDirectory, `${id}.json`), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function localAddresses() {
  return Object.values(os.networkInterfaces()).flatMap((interfaces) => (interfaces || [])
    .filter((item) => item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}`));
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, commonHeaders);
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true, addresses: localAddresses() });
    return;
  }

  const routeMatch = url.pathname.match(/^\/matches\/([a-z0-9-]{1,100})\/?$/i);
  if (!routeMatch || !validId(routeMatch[1])) {
    sendJson(response, 404, { error: 'Not found.' });
    return;
  }

  const id = routeMatch[1];
  try {
    if (request.method === 'GET') {
      const token = url.searchParams.get('token');
      if (!tokenMatches(token, token)) {
        sendJson(response, 403, { error: 'Invalid report link.' });
        return;
      }
      const record = await readRecord(id);
      if (!record || !tokenMatches(record.token, token)) {
        sendJson(response, 404, { error: 'Match report not available yet.' });
        return;
      }
      sendJson(response, 200, { match: record.match, updatedAt: record.updatedAt });
      return;
    }

    if (request.method === 'PUT') {
      let payload;
      try {
        payload = await readBody(request);
      } catch (error) {
        sendJson(response, error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'Invalid request body.' });
        return;
      }
      if (!payload || !tokenMatches(payload.token, payload.match?.shareToken) || payload.match?.id !== id) {
        sendJson(response, 400, { error: 'Invalid match snapshot.' });
        return;
      }
      const existing = await readRecord(id);
      if (existing && !tokenMatches(existing.token, payload.token)) {
        sendJson(response, 403, { error: 'This match link is already in use.' });
        return;
      }
      await mkdir(dataDirectory, { recursive: true });
      const temporaryPath = path.join(dataDirectory, `${id}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporaryPath, JSON.stringify({ token: payload.token, updatedAt: new Date().toISOString(), match: payload.match }), 'utf8');
        await rename(temporaryPath, path.join(dataDirectory, `${id}.json`));
      } finally {
        await rm(temporaryPath, { force: true });
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch {
    sendJson(response, 500, { error: 'Share server error.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`GamePath share server listening on port ${port}`);
  for (const address of localAddresses()) console.log(`Coach network address: ${address}`);
  if (!localAddresses().length) console.log(`Local address: http://localhost:${port}`);
});
