import { spawnSync } from 'node:child_process';

/** True when `cmd` can be started (it is on PATH, or is an absolute/relative executable). */
export function commandOnPath(cmd: string): boolean {
  if (!cmd) return false;
  const probe = process.platform === 'win32'
    ? spawnSync('where', [cmd], { stdio: 'ignore' })
    : spawnSync('which', [cmd], { stdio: 'ignore' });
  return probe.status === 0;
}

/**
 * Interpreter for the local video CLI and `npm run test:video`.
 * GAMEPATH_PYTHON always wins. Otherwise use `python` when it is on PATH,
 * then fall back to `python3` (common on Linux and macOS).
 */
export function resolvePython(
  env: Record<string, string | undefined> = process.env,
  available: (cmd: string) => boolean = commandOnPath,
): string {
  const override = env.GAMEPATH_PYTHON?.trim();
  if (override) return override;
  if (available('python')) return 'python';
  if (available('python3')) return 'python3';
  return 'python';
}
