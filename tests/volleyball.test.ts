import test from 'node:test';
import assert from 'node:assert/strict';

import { calculatePlayerStats, calculateTeamStats } from '../lib/volleyball';

const sampleEvents = [
  { eventType: 'attack_attempt', team: 'home', athleteId: 'p1', success: true },
  { eventType: 'kill', team: 'home', athleteId: 'p1', success: true },
  { eventType: 'attack_attempt', team: 'home', athleteId: 'p1', success: true },
  { eventType: 'attack_error', team: 'home', athleteId: 'p1', success: false },
  { eventType: 'serve_attempt', team: 'home', athleteId: 'p2', success: true },
  { eventType: 'ace', team: 'home', athleteId: 'p2', success: true },
  { eventType: 'reception_attempt', team: 'home', athleteId: 'p3', success: true, rating: 3 },
  { eventType: 'reception_attempt', team: 'home', athleteId: 'p3', success: true, rating: 2 },
  { eventType: 'reception_error', team: 'home', athleteId: 'p3', success: false },
  { eventType: 'dig', team: 'home', athleteId: 'p4', success: true },
  { eventType: 'assist', team: 'home', athleteId: 'p5', success: true },
  { eventType: 'setting_error', team: 'home', athleteId: 'p5', success: false },
];

test('calculatePlayerStats computes hitting and serving rates deterministically', () => {
  const stats = calculatePlayerStats(sampleEvents, 'p1');

  assert.equal(stats.attackAttempts, 2);
  assert.equal(stats.kills, 1);
  assert.equal(stats.attackErrors, 1);
  assert.equal(stats.hittingPercentage, 0);
  assert.equal(stats.killPercentage, 50);
  assert.equal(stats.attackErrorPercentage, 50);
});

test('calculateTeamStats produces correct aggregate performance', () => {
  const stats = calculateTeamStats(sampleEvents);

  assert.equal(stats.serveAttempts, 1);
  assert.equal(stats.aces, 1);
  assert.equal(stats.acePercentage, 100);
  assert.equal(stats.averageReceptionRating, 2.5);
  assert.equal(stats.receptionErrorRate, 50);
  assert.equal(stats.digsPerSet, 1);
  assert.equal(stats.assistsPerSet, 1);
});
