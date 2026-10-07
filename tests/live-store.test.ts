import assert from 'node:assert/strict';
import test from 'node:test';

import { LivePublishError, emptyLiveStore, publishLiveMatch, readLiveMatch, registerLiveDevice, updateLiveCamera } from '../lib/live-store';

const token = 'a'.repeat(64);
const other = 'b'.repeat(64);

test('publishing a match keeps the previous snapshot when the token is wrong', () => {
  const first = publishLiveMatch(emptyLiveStore(), 'match-1', token, { rallies: [{ number: 1 }] }, [], '2026-10-07T12:00:00.000Z');
  assert.throws(
    () => publishLiveMatch(first, 'match-1', other, { rallies: [] }, [], '2026-10-07T12:00:01.000Z'),
    (error: unknown) => error instanceof LivePublishError && error.status === 403,
  );
  assert.equal((first.matches['match-1'].match.rallies as unknown[]).length, 1);
  assert.throws(() => readLiveMatch(first, 'match-1', other), LivePublishError);
});

test('a coach cannot overwrite rallies, and a camera setup leaves them in place', () => {
  const published = publishLiveMatch(emptyLiveStore(), 'match-1', token, {
    rallies: [{ number: 1 }],
    cameras: [{ id: 'cam-1', position: 'near-end', pictureEdge: 'bottom' }],
  }, [], '2026-10-07T12:00:00.000Z');
  const withCoach = registerLiveDevice(published, { id: 'phone-coach', role: 'coach', label: 'Bench', matchId: 'match-1', token, seenAt: '2026-10-07T12:00:01.000Z' });
  assert.throws(
    () => publishLiveMatch(withCoach, 'match-1', token, { rallies: [] }, [], '2026-10-07T12:00:02.000Z', { deviceId: 'phone-coach', baseRevision: 1 }),
    (error: unknown) => error instanceof LivePublishError && error.status === 403,
  );
  assert.equal((withCoach.matches['match-1'].match.rallies as unknown[]).length, 1);
  const withCamera = registerLiveDevice(withCoach, { id: 'phone-cam', role: 'camera', label: 'End line', matchId: 'match-1', token, cameraId: 'cam-1', seenAt: '2026-10-07T12:00:03.000Z' });
  const moved = updateLiveCamera(withCamera, 'match-1', token, { id: 'cam-1', position: 'far-end', pictureEdge: 'left' }, 'phone-cam', '2026-10-07T12:00:04.000Z');
  const cameras = moved.matches['match-1'].match.cameras as Array<{ pictureEdge: string }>;
  assert.equal(cameras[0].pictureEdge, 'left');
  assert.equal((moved.matches['match-1'].match.rallies as unknown[]).length, 1);
});

test('a stale stat keeper does not replace a newer rally', () => {
  const first = publishLiveMatch(emptyLiveStore(), 'match-1', token, { rallies: [{ number: 1 }] }, [], '2026-10-07T12:00:00.000Z');
  const second = publishLiveMatch(first, 'match-1', token, { rallies: [{ number: 1 }, { number: 2 }] }, [], '2026-10-07T12:00:02.000Z', { baseRevision: 1 });
  assert.throws(
    () => publishLiveMatch(second, 'match-1', token, { rallies: [{ number: 9 }] }, [], '2026-10-07T12:00:03.000Z', { baseRevision: 1 }),
    (error: unknown) => error instanceof LivePublishError && error.status === 409,
  );
  assert.equal((second.matches['match-1'].match.rallies as unknown[]).length, 2);
});

test('the same token replaces the snapshot with the newer rally', () => {
  const first = publishLiveMatch(emptyLiveStore(), 'match-1', token, { rallies: [{ number: 1 }] }, [{ id: 'a3', jersey: 5 }], '2026-10-07T12:00:00.000Z');
  const second = publishLiveMatch(first, 'match-1', token, { rallies: [{ number: 1 }, { number: 2 }] }, [{ id: 'a3', jersey: 5 }], '2026-10-07T12:00:02.000Z');
  const read = readLiveMatch(second, 'match-1', token);
  assert.equal((read.match.rallies as unknown[]).length, 2);
  assert.equal(read.updatedAt, '2026-10-07T12:00:02.000Z');
  assert.equal(first.matches['match-1'].updatedAt, '2026-10-07T12:00:00.000Z');
});
