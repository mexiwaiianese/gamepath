import os from 'node:os';

export function isShareAddress(address: string) {
  if (address.startsWith('192.168.') || address.startsWith('10.')) return true;
  const parts = address.split('.').map(Number);
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

export function isVirtualAdapter(name: string) {
  return /vethernet|bluetooth|loopback|wsl|hyper-v|default switch|virtual/i.test(name);
}

export function shareHostFrom(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>) {
  const rows: { name: string; address: string }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      if ((family === 'IPv4' || family === 4) && !entry.internal) rows.push({ name, address: entry.address });
    }
  }
  const hotspot = rows.find((row) => row.address === '192.168.137.1');
  if (hotspot) return hotspot.address;
  const usable = rows.filter((row) => isShareAddress(row.address) && !isVirtualAdapter(row.name));
  return usable.find((row) => /wi-?fi|wlan/i.test(row.name))?.address ?? usable[0]?.address ?? '127.0.0.1';
}

export function shareHost() {
  return shareHostFrom(os.networkInterfaces());
}
