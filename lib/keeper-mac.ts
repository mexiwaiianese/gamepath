/** Resolve the stat keeper's MAC from the team-network address. Browsers cannot read it. */

import { execFileSync } from 'node:child_process';

const EMPTY_MAC = /^(00[:-]){5}00$/i;

export function normalizeMac(value: string) {
  const hex = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 12) return null;
  const mac = hex.match(/.{2}/g)?.join(':') ?? null;
  if (!mac || EMPTY_MAC.test(mac)) return null;
  return mac;
}

export function macFromArp(output: string, ip: string) {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{11,17})/);
    if (match?.[1] === ip) return normalizeMac(match[2]);
  }
  return null;
}

export function macFromGetmac(output: string) {
  const rows = output.split(/\r?\n/).flatMap((line) => {
    const columns = line.match(/"([^"]*)"/g)?.map((column) => column.slice(1, -1)) ?? [];
    if (columns.length < 3) return [];
    const mac = normalizeMac(columns[2] ?? '');
    if (!mac) return [];
    return [{ name: `${columns[0]} ${columns[1]}`.toLowerCase(), mac }];
  });
  return rows.find((row) => row.name.includes('wi-fi') || row.name.includes('wifi') || row.name.includes('ethernet'))?.mac ?? rows[0]?.mac ?? null;
}

export function lookupMac(remoteAddress: string) {
  const ip = remoteAddress.replace(/^::ffff:/, '');
  try {
    if (ip === '127.0.0.1' || ip === '::1' || ip === '') return macFromGetmac(execFileSync('getmac', ['/fo', 'csv', '/v'], { encoding: 'utf8', timeout: 4000 }));
    return macFromArp(execFileSync('arp', ['-a', ip], { encoding: 'utf8', timeout: 4000 }), ip);
  } catch {
    return null;
  }
}
