import test from 'node:test';
import assert from 'node:assert/strict';

import { cameraSetupUrl, cameraWithPosition, camerasForCount, ensureCameras, readStoredCamera, writeStoredCamera, type MatchCamera } from '../lib/cameras';

test('a new game can hold two cameras in different places', () => {
  const ids = ['cam-a', 'cam-b', 'cam-c', 'cam-d'];
  const cameras = camerasForCount(2, [], ids);
  assert.deepEqual(cameras.map((camera) => camera.position), ['near-end', 'far-end']);
  assert.deepEqual(cameras.map((camera) => camera.id), ['cam-a', 'cam-b']);
  assert.equal(cameras[0].pictureEdge, 'bottom');
});

test('changing the camera count keeps the cameras already chosen', () => {
  const ids = ['cam-a', 'cam-b', 'cam-c', 'cam-d'];
  const first = camerasForCount(1, [], ids);
  const grown = camerasForCount(3, first, ids);
  assert.equal(grown[0].id, 'cam-a');
  assert.equal(grown[0].position, 'near-end');
  assert.equal(grown[2].position, 'left-sideline');
});

test('picking a position another camera already uses swaps them', () => {
  const cameras: MatchCamera[] = [
    { id: 'cam-a', position: 'near-end', pictureEdge: 'bottom' },
    { id: 'cam-b', position: 'far-end', pictureEdge: 'left' },
  ];
  const swapped = cameraWithPosition(cameras, 1, 'near-end');
  assert.equal(swapped[0].position, 'far-end');
  assert.equal(swapped[1].position, 'near-end');
  assert.equal(swapped[1].pictureEdge, 'left');
});

test('each camera gets its own local setup address', () => {
  const url = new URL(cameraSetupUrl('http://127.0.0.1:3000', 'match-1', 'cam-b'));
  assert.equal(url.origin, 'http://127.0.0.1:3000');
  assert.equal(url.pathname, '/camera/');
  assert.equal(url.searchParams.get('match'), 'match-1');
  assert.equal(url.searchParams.get('camera'), 'cam-b');
});

test('a saved game without cameras still opens one near-end setup', () => {
  const cameras = ensureCameras('match-old');
  assert.equal(cameras.length, 1);
  assert.equal(cameras[0].position, 'near-end');
  const raw = JSON.stringify({ match: { id: 'match-old', team: 'North', opponent: 'Herriman' } });
  const found = readStoredCamera(raw, 'match-old', cameras[0].id);
  assert.equal(found?.opponent, 'Herriman');
  const saved = writeStoredCamera(raw, 'match-old', { ...cameras[0], pictureEdge: 'left' });
  assert.equal(readStoredCamera(saved!, 'match-old', cameras[0].id)?.camera.pictureEdge, 'left');
});
