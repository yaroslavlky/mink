import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { dump } from 'js-yaml';
import type { MinkConfiguration } from './types/schema.js';
import { validateConfig } from './config/load.js';

export type TemplateName = 'node' | 'python' | 'rust' | 'go' | 'monorepo' | 'compose-stack';
export async function initTemplate(
  name: TemplateName,
  file = 'mink.yml',
  cwd = process.cwd(),
): Promise<string> {
  const commands: MinkConfiguration['commands'] = {
    ...(name === 'node'
      ? { dev: task('Development', 'npm', ['run', 'dev']), test: task('Tests', 'npm', ['test']) }
      : {}),
    ...(name === 'python'
      ? {
          test: task('Tests', 'python', ['-m', 'pytest']),
          run: task('Run', 'python', ['-m', 'app']),
        }
      : {}),
    ...(name === 'rust'
      ? { build: task('Build', 'cargo', ['build']), test: task('Tests', 'cargo', ['test']) }
      : {}),
    ...(name === 'go'
      ? {
          build: task('Build', 'go', ['build', './...']),
          test: task('Tests', 'go', ['test', './...']),
        }
      : {}),
    ...(name === 'monorepo'
      ? {
          build: task('Build workspaces', 'pnpm', ['-r', 'build']),
          test: task('Test workspaces', 'pnpm', ['-r', 'test']),
        }
      : {}),
    ...(name === 'compose-stack'
      ? {
          up: task('Start stack', 'docker', ['compose', 'up', '--detach']),
          down: task('Stop stack', 'docker', ['compose', 'down']),
        }
      : {}),
  };
  const config: MinkConfiguration = { version: 1, commands };
  validateConfig(config);
  const target = resolve(cwd, file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, dump(config, { noRefs: true, lineWidth: 100 }), {
    flag: 'wx',
    mode: 0o600,
  });
  return target;
}
function task(name: string, exec: string, args: string[]): MinkConfiguration['commands'][string] {
  return { kind: 'command', name, exec, args };
}

export async function installGitHooks(
  directory: string,
  commands: { preCommit?: string; prePush?: string },
): Promise<string[]> {
  const hooks = join(directory, '.git', 'hooks');
  await mkdir(hooks, { recursive: true });
  const installed: string[] = [];
  for (const [name, command] of [
    ['pre-commit', commands.preCommit],
    ['pre-push', commands.prePush],
  ] as const) {
    if (!command) continue;
    const file = join(hooks, name);
    const staged = name === 'pre-commit' ? ' --affected --since HEAD --only' : ' --affected';
    await writeFile(file, `#!/bin/sh\nexec mink run ${shellWord(command)}${staged}\n`, {
      flag: 'wx',
      mode: 0o700,
    });
    await chmod(file, 0o700);
    installed.push(file);
  }
  return installed;
}
function shellWord(value: string): string {
  if (!/^[A-Za-z0-9_./:-]+$/.test(value)) throw new Error(`Unsafe hook command ID: ${value}`);
  return value;
}
