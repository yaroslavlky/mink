import { spawnOwned } from '../runtime/platform.js';

export async function resolveDynamicOptions(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<string[]> {
  let output = '';
  const process = spawnOwned({ command, env, args: [], cwd }, 'ignore', (stream, chunk) => {
    if (stream === 'stdout') output += chunk;
  });
  const result = await process.completion;
  if (result.code !== 0)
    throw new Error(`Dynamic options command failed with exit code ${result.code ?? 'unknown'}`);
  const options = [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (!options.length) throw new Error('Dynamic options command returned no values');
  return options;
}
