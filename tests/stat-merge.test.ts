import assert from 'node:assert/strict';
import test from 'node:test';

import { emptyAccuracyFile, historicalAccuracy, withMatchSlices } from '../lib/stat-accuracy';
import { macFromArp, macFromGetmac, normalizeMac } from '../lib/keeper-mac';
import { emptyLiveStore, submitKeeperBook } from '../lib/live-store';
import { mergeStatBooks, type StatBook } from '../lib/stat-merge';

const token = 'c'.repeat(64);

function book(partial: Partial<StatBook> & Pick<StatBook, 'deviceId' | 'master'>): StatBook {
  return { mac: partial.mac ?? partial.deviceId, label: partial.label ?? partial.deviceId, rallies: partial.rallies ?? [], current: partial.current ?? [], ...partial };
}

test('two keepers agreeing confirms the touch and a disagreement keeps the master label', () => {
  const agreed = mergeStatBooks([
    book({ deviceId: 'computer', master: true, rallies: [{ number: 1, events: [{ eventType: 'kill', athleteId: 'a7' }] }] }),
    book({ deviceId: 'phone', master: false, rallies: [{ number: 1, events: [{ eventType: 'kill', athleteId: 'a7' }] }] }),
  ], { computer: 0.5 });
  assert.equal(agreed.touches[0]?.status, 'confirmed');
  assert.equal(agreed.touches[0]?.weight, 1);
  assert.equal(agreed.confidence, 1);
  assert.equal(agreed.slices.computer?.confirmed, 1);
  assert.equal(agreed.slices.phone?.confirmed, 1);

  const split = mergeStatBooks([
    book({ deviceId: 'computer', master: true, mac: 'AA:AA:AA:AA:AA:AA', rallies: [{ number: 1, events: [{ eventType: 'kill', athleteId: 'a7' }] }] }),
    book({ deviceId: 'phone', master: false, rallies: [{ number: 1, events: [{ eventType: 'attack_error', athleteId: 'a7' }] }] }),
  ], { 'AA:AA:AA:AA:AA:AA': 0.25 });
  assert.equal(split.touches[0]?.status, 'accepted');
  assert.equal(split.touches[0]?.weight, 0.25);
  assert.equal(split.confirmed, 0);
  assert.equal(split.accepted, 1);
  assert.equal(split.slices['AA:AA:AA:AA:AA:AA']?.confirmed, 0);
  assert.equal(split.slices.phone?.total, 1);
});

test('a solo keeper is accepted at past accuracy, and another keeper extra rally waits', () => {
  const solo = mergeStatBooks([
    book({ deviceId: 'computer', master: true, mac: 'AA:AA:AA:AA:AA:AA', rallies: [{ number: 1, events: [{ eventType: 'ace', athleteId: 'a2' }] }] }),
  ], {});
  assert.equal(solo.touches[0]?.status, 'accepted');
  assert.equal(solo.touches[0]?.weight, 0);
  assert.equal(solo.pending.length, 0);

  const seasoned = mergeStatBooks([
    book({ deviceId: 'computer', master: true, mac: 'AA:AA:AA:AA:AA:AA', rallies: [{ number: 1, events: [{ eventType: 'ace', athleteId: 'a2' }] }] }),
  ], { 'AA:AA:AA:AA:AA:AA': 0.8 });
  assert.equal(seasoned.confidence, 0.8);

  const waiting = mergeStatBooks([
    book({ deviceId: 'computer', master: true, rallies: [] }),
    book({ deviceId: 'phone', master: false, label: 'Bench', rallies: [{ number: 4, events: [{ eventType: 'dig', athleteId: 'a1' }] }] }),
  ], {});
  assert.equal(waiting.touches.length, 0);
  assert.equal(waiting.pending[0]?.keeper, 'Bench');
  assert.equal(waiting.pending[0]?.rallyNumber, 4);
});

test('a secondary book does not replace the master match', () => {
  const master = submitKeeperBook(emptyLiveStore(), 'match-1', token, 'computer', { rallies: [{ number: 1, events: [{ eventType: 'kill', athleteId: 'a7' }] }] }, [], '2026-10-07T12:00:00.000Z', { mac: 'AA:AA:AA:AA:AA:AA', label: 'Scorer', claimMaster: true, accuracyByMac: {} });
  const phone = submitKeeperBook(master.store, 'match-1', token, 'phone', { rallies: [{ number: 1, events: [{ eventType: 'attack_error', athleteId: 'a3' }] }, { number: 2, events: [{ eventType: 'ace', athleteId: 'a2' }] }] }, [], '2026-10-07T12:00:01.000Z', { mac: 'BB:BB:BB:BB:BB:BB', label: 'Phone', claimMaster: false, accuracyByMac: {} });
  const committed = phone.store.matches['match-1'];
  assert.equal((committed.match.rallies as Array<{ number: number }>).length, 1);
  assert.equal(committed.statConfirmed, 0);
  assert.equal(committed.statAccepted, 1);
  assert.equal(committed.pendingStats?.[0]?.rallyNumber, 2);
  assert.equal(committed.masterDeviceId, 'computer');
});

test('historical accuracy ignores the match being recomputed', () => {
  const first = withMatchSlices(emptyAccuracyFile(), 'match-1', { 'AA:AA:AA:AA:AA:AA': { confirmed: 1, total: 2 } });
  const second = withMatchSlices(first, 'match-2', { 'AA:AA:AA:AA:AA:AA': { confirmed: 2, total: 2 } });
  assert.equal(historicalAccuracy(second, 'match-2')['AA:AA:AA:AA:AA:AA'], 0.5);
  const replaced = withMatchSlices(second, 'match-1', { 'AA:AA:AA:AA:AA:AA': { confirmed: 2, total: 2 } });
  assert.equal(replaced.keepers['AA:AA:AA:AA:AA:AA']?.matches['match-1']?.confirmed, 2);
  assert.equal(historicalAccuracy(replaced, 'match-9')['AA:AA:AA:AA:AA:AA'], 1);
});

test('MAC text from Windows arp and getmac is normalized', () => {
  assert.equal(normalizeMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.equal(normalizeMac('00-00-00-00-00-00'), null);
  assert.equal(macFromArp('  192.168.137.23        aa-bb-cc-dd-ee-ff     dynamic', '192.168.137.23'), 'AA:BB:CC:DD:EE:FF');
  const csv = '"Wi-Fi","Intel","A1-B2-C3-D4-E5-F6","ok"\n"Bluetooth Network Connection","Bluetooth"," ",""';
  assert.equal(macFromGetmac(csv), 'A1:B2:C3:D4:E5:F6');
});
