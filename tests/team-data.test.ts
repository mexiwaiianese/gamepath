import test from 'node:test';
import assert from 'node:assert/strict';

import { isLibero, migrateAthlete, normalizeSeasonStarters, pointAwardedTo, type Athlete } from '../lib/team-data';

test('legacy athlete names and positions migrate into explicit player fields', () => {
  assert.deepEqual(migrateAthlete({ id: 'p1', jersey: 12, name: 'Jordan Lee', position: 'Setter' }), {
    id: 'p1',
    jersey: 12,
    firstName: 'Jordan',
    lastName: 'Lee',
    positions: ['Setter'],
    libero: false,
  });
});

test('rally scoring awards every rally to its winner', () => {
  assert.equal(pointAwardedTo('rally', 'home', 'away'), 'away');
});

test('side-out scoring awards a point only to the serving team', () => {
  assert.equal(pointAwardedTo('side-out', 'home', 'home'), 'home');
  assert.equal(pointAwardedTo('side-out', 'home', 'away'), null);
});

test('season starters exclude libero players and normalize to six court players', () => {
  const players: Athlete[] = [
    { id: 'libero-1', jersey: 1, firstName: 'Libby', lastName: 'One', positions: ['Libero'] },
    { id: 'libero-2', jersey: 2, firstName: 'Libby', lastName: 'Two', positions: ['Libero'], libero: true },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `player-${index + 1}`,
      jersey: index + 3,
      firstName: 'Court',
      lastName: `Player ${index + 1}`,
      positions: ['Outside Hitter'],
    })),
  ];
  const season = normalizeSeasonStarters({ id: 's1', name: 'Fall', starters: ['libero-1', ...players.slice(2, 7).map((player) => player.id)] }, players);

  assert.equal(season.starters.length, 6);
  assert.equal(season.starters.some((id) => players.some((player) => player.id === id && isLibero(player))), false);
  assert.equal(isLibero(players[0]), true);
  assert.equal(isLibero(players[1]), true);
});