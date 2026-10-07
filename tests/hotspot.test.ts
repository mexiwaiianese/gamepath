import assert from 'node:assert/strict';
import test from 'node:test';

import { HotspotConfigError, applyHotspotPatch, wifiJoinCode } from '../lib/hotspot';

test('the first save creates a password and leaves every other field alone', () => {
  const stored = { note: 'keep me', video: true };
  const saved = applyHotspotPatch(stored, {}, () => 'first-pass');
  assert.equal(saved.ssid, 'GamePath');
  assert.equal(saved.passphrase, 'first-pass');
  assert.equal(saved.maxPeers, 16);
  assert.equal(saved.note, 'keep me');
  assert.equal(saved.video, true);
  assert.equal(stored.note, 'keep me');
});

test('running setup again keeps the password, name, and unrelated settings', () => {
  const stored = { ssid: 'GamePath', passphrase: 'already-set', maxPeers: 16, note: 'keep me' };
  const saved = applyHotspotPatch(stored, { maxPeers: 20 }, () => 'should-not-be-used');
  assert.equal(saved.passphrase, 'already-set');
  assert.equal(saved.ssid, 'GamePath');
  assert.equal(saved.maxPeers, 20);
  assert.equal(saved.note, 'keep me');
});

test('a blank password on a later save does not replace the saved password', () => {
  const stored = { passphrase: 'already-set', ssid: 'Bench', maxPeers: 12 };
  const saved = applyHotspotPatch(stored, { passphrase: '   ' }, () => 'should-not-be-used');
  assert.equal(saved.passphrase, 'already-set');
  assert.equal(saved.ssid, 'Bench');
});

test('typing a new password replaces only the password', () => {
  const stored = { passphrase: 'already-set', ssid: 'Bench', maxPeers: 12, note: 'keep me' };
  const saved = applyHotspotPatch(stored, { passphrase: 'new-secret' });
  assert.equal(saved.passphrase, 'new-secret');
  assert.equal(saved.ssid, 'Bench');
  assert.equal(saved.note, 'keep me');
});

test('bad device limits and names are rejected before anything is saved', () => {
  assert.throws(() => applyHotspotPatch(null, { maxPeers: 0 }, () => 'long-enough'), HotspotConfigError);
  assert.throws(() => applyHotspotPatch(null, { maxPeers: 129 }, () => 'long-enough'), HotspotConfigError);
  assert.throws(() => applyHotspotPatch(null, { ssid: ' ' }, () => 'long-enough'), HotspotConfigError);
  assert.throws(() => applyHotspotPatch(null, { passphrase: 'short' }), HotspotConfigError);
});

test('the join code carries the network name and password', () => {
  assert.equal(wifiJoinCode('GamePath', 'already-set'), 'WIFI:T:WPA;S:GamePath;P:already-set;;');
});
