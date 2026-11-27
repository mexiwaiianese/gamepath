import { spawnSync } from 'node:child_process';

import { resolvePython } from '../lib/python';

const python = resolvePython();
const result = spawnSync(
  python,
  ['-m', 'unittest', 'discover', '-s', 'services/video/tests', '-t', 'services/video'],
  { stdio: 'inherit' },
);
if (result.error) {
  console.error(`Could not start ${python}. Set GAMEPATH_PYTHON to a working interpreter, or install python/python3.`);
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
