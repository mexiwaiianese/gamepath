import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePython } from '../lib/python';

test('resolvePython honors GAMEPATH_PYTHON, then python, then python3', () => {
  assert.equal(resolvePython({ GAMEPATH_PYTHON: '/custom/python' }, () => false), '/custom/python');
  assert.equal(resolvePython({ GAMEPATH_PYTHON: '  ' }, (cmd) => cmd === 'python3'), 'python3');
  assert.equal(resolvePython({}, (cmd) => cmd === 'python'), 'python');
  assert.equal(resolvePython({}, (cmd) => cmd === 'python3'), 'python3');
  assert.equal(resolvePython({ GAMEPATH_PYTHON: 'python3' }, (cmd) => cmd === 'python'), 'python3');
  assert.equal(resolvePython({}, () => false), 'python');
});
