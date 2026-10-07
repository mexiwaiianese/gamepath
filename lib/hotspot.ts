/** Team-network settings. This module never reads match, roster, or video files. */

export const HOTSPOT_SCHEMA = 'gamepath.hotspot.v1';
export const HOTSPOT_HELPER_URL = 'http://127.0.0.1:3847';
export const DEFAULT_HOTSPOT_SSID = 'GamePath';
export const DEFAULT_HOTSPOT_PEERS = 16;
export const MIN_HOTSPOT_PEERS = 1;
export const MAX_HOTSPOT_PEERS = 128;
const PASSPHRASE_MIN = 8;
const PASSPHRASE_MAX = 63;
const SSID_MAX = 32;
const PASS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type HotspotPatch = {
  ssid?: string;
  passphrase?: string;
  maxPeers?: number;
};

export class HotspotConfigError extends Error {}

export function generateHotspotPassphrase(length = 12) {
  const size = Math.max(PASSPHRASE_MIN, length);
  const values = new Uint32Array(size);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => PASS_ALPHABET[value % PASS_ALPHABET.length]).join('');
}

export function applyHotspotPatch(
  stored: Record<string, unknown> | null,
  patch: HotspotPatch,
  generatePassphrase: () => string = generateHotspotPassphrase,
) {
  const base = stored ? { ...stored } : {};
  const ssid = normalizeSsid(patch.ssid ?? readString(base.ssid) ?? DEFAULT_HOTSPOT_SSID);
  const requested = patch.passphrase?.trim() ?? '';
  const existing = readString(base.passphrase) ?? '';
  const passphrase = requested || existing || generatePassphrase();
  validatePassphrase(passphrase);
  const maxPeers = normalizePeers(patch.maxPeers ?? base.maxPeers);
  return { ...base, schema: HOTSPOT_SCHEMA, ssid, passphrase, maxPeers };
}

export function wifiJoinCode(ssid: string, passphrase: string) {
  const escape = (value: string) => value.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:WPA;S:${escape(ssid)};P:${escape(passphrase)};;`;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeSsid(value: string) {
  const ssid = value.trim();
  if (!ssid || ssid.length > SSID_MAX) {
    throw new HotspotConfigError('Network name must be 1 to 32 characters.');
  }
  return ssid;
}

function validatePassphrase(value: string) {
  if (value.length < PASSPHRASE_MIN || value.length > PASSPHRASE_MAX || /[\u0000-\u001f]/.test(value)) {
    throw new HotspotConfigError('Wi-Fi password must be 8 to 63 characters.');
  }
}

function normalizePeers(value: unknown) {
  const peers = typeof value === 'number' ? value : DEFAULT_HOTSPOT_PEERS;
  if (!Number.isInteger(peers) || peers < MIN_HOTSPOT_PEERS || peers > MAX_HOTSPOT_PEERS) {
    throw new HotspotConfigError(`Device limit must be a whole number from ${MIN_HOTSPOT_PEERS} to ${MAX_HOTSPOT_PEERS}.`);
  }
  return peers;
}
