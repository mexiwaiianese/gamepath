import assert from 'node:assert/strict';
import test from 'node:test';
import type os from 'node:os';

import { followsCommittedScoreboard } from '../lib/live-report';
import { shareHostFrom } from '../lib/share-host';

function iface(address: string): os.NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/24` };
}

test('a running hotspot is the address phones should open', () => {
  const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
    'Wi-Fi': [iface('192.168.86.36')],
    'Local Area Connection* 1': [iface('192.168.137.1')],
  };
  assert.equal(shareHostFrom(interfaces), '192.168.137.1');
});

test('a joined phone follows the computer scoreboard', () => {
  assert.equal(followsCommittedScoreboard({ deviceMaster: false, deviceId: 'phone', masterDeviceId: 'computer' }), true);
  assert.equal(followsCommittedScoreboard({ deviceMaster: true, deviceId: 'computer', masterDeviceId: 'computer' }), false);
});

test('without a hotspot, the computer Wi-Fi address is used', () => {
  const interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
    'vEthernet (Default Switch)': [iface('172.20.176.1')],
    Ethernet: [iface('192.168.86.49')],
    'Wi-Fi': [iface('192.168.86.36')],
  };
  assert.equal(shareHostFrom(interfaces), '192.168.86.36');
});
