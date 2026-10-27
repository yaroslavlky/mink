import { spawnOwned } from './runtime/platform.js';

export async function upgradeMink(
  onOutput?: (chunk: string, stderr: boolean) => void,
): Promise<void> {
  const handle = spawnOwned(
    {
      command: 'npm',
      executable: globalThis.process.platform === 'win32' ? 'npm.cmd' : 'npm',
      args: ['install', '--global', '@yaroslavlky/mink@latest'],
      env: {},
    },
    'inherit',
    (stream, chunk) => onOutput?.(chunk, stream === 'stderr'),
  );
  const result = await handle.completion;
  if (result.error) throw new Error(result.error);
  if (result.code !== 0) throw new Error(`npm exited with code ${result.code ?? 'unknown'}`);
}
