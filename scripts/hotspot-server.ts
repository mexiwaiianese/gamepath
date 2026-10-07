/** Local helper for the team network. Listens on this computer only. */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOTSPOT_HELPER_URL, HotspotConfigError, applyHotspotPatch, type HotspotPatch } from '../lib/hotspot';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, '.gamepath');
const configPath = path.join(folder, 'hotspot.json');
const statusPath = path.join(folder, 'hotspot-status.json');
const scriptPath = path.join(root, 'scripts', 'hotspot.ps1');
const port = new URL(HOTSPOT_HELPER_URL).port;
let applying = false;

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.url === '/hotspot' && request.method === 'GET') {
    send(response, 200, { config: readConfig(), status: readStatus() });
    return;
  }
  if (request.url === '/hotspot' && request.method === 'POST') {
    void apply(request, response);
    return;
  }
  send(response, 404, { message: 'Not found' });
});

server.listen(Number(port), '127.0.0.1', () => {
  console.log(`Team network helper: ${HOTSPOT_HELPER_URL}`);
});

async function apply(request: http.IncomingMessage, response: http.ServerResponse) {
  if (applying) {
    send(response, 409, { message: 'Team network setup is already running.' });
    return;
  }
  applying = true;
  try {
    const patch = await readBody(request);
    const saved = applyHotspotPatch(readConfig(), patch);
    fs.mkdirSync(folder, { recursive: true });
    const temporary = `${configPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(saved, null, 2));
    fs.renameSync(temporary, configPath);
    fs.rmSync(statusPath, { force: true });
    const code = await runElevated(Boolean(patch.ensureLoopback));
    const status = readStatus();
    if (code !== 0) {
      send(response, 400, { config: saved, status, message: status?.message ?? 'Windows did not enable the team network. Saved settings were kept.' });
      return;
    }
    send(response, 200, { config: saved, status });
  } catch (error) {
    const message = error instanceof HotspotConfigError || error instanceof Error ? error.message : 'Could not save the team network.';
    const status = message.includes('canceled') ? 400 : error instanceof HotspotConfigError ? 400 : 500;
    send(response, status, { message, config: readConfig() });
  } finally {
    applying = false;
  }
}

function runElevated(ensureLoopback: boolean) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Config', configPath];
  if (ensureLoopback) args.push('-EnsureLoopback');
  const command = `$process = Start-Process -FilePath powershell.exe -ArgumentList ${args.map(psQuote).join(',')} -Verb RunAs -Wait -PassThru; if ($null -eq $process) { exit 1 }; exit $process.ExitCode`;
  return new Promise<number>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true });
    let errorText = '';
    child.stderr.on('data', (chunk) => { errorText += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (/canceled by the user/i.test(errorText)) {
        reject(new Error('Windows approval was canceled. Saved settings were kept.'));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function readBody(request: http.IncomingMessage) {
  return new Promise<HotspotPatch & { ensureLoopback?: boolean }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => {
      chunks.push(chunk);
      if (chunks.reduce((total, item) => total + item.length, 0) > 8192) {
        reject(new HotspotConfigError('Team network settings are too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as HotspotPatch & { ensureLoopback?: boolean };
        resolve({
          ssid: typeof parsed.ssid === 'string' ? parsed.ssid : undefined,
          passphrase: typeof parsed.passphrase === 'string' ? parsed.passphrase : undefined,
          maxPeers: typeof parsed.maxPeers === 'number' ? parsed.maxPeers : undefined,
          ensureLoopback: parsed.ensureLoopback === true,
        });
      } catch {
        reject(new HotspotConfigError('Team network settings were not valid.'));
      }
    });
    request.on('error', reject);
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8')) as { ok?: boolean; message?: string; ssid?: string; maxPeers?: number; gateway?: string };
  } catch {
    return null;
  }
}

function psQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function send(response: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  response.end(payload);
}
