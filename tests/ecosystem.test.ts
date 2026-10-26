import { expect, it } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createMink,
  createPluginRegistry,
  defineConfig,
  initTemplate,
  installGitHooks,
} from '../packages/core/src/index.js';
import { command, directory } from './helpers.js';

it('discovers just, Procfile, Deno, Rust, Go and Python tasks without executing them', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'justfile'), 'check:\n\ttrue\n');
  await writeFile(join(dir, 'Procfile'), 'web: node server.js\n');
  await writeFile(join(dir, 'deno.json'), JSON.stringify({ tasks: { lint: 'deno lint' } }));
  await writeFile(join(dir, 'Cargo.toml'), '[package]\nname="demo"\n');
  await writeFile(join(dir, 'go.mod'), 'module demo\n');
  await writeFile(join(dir, 'pyproject.toml'), '[project.scripts]\nhello = "demo.cli:main"\n');
  const mink = await createMink({ cwd: dir, stateDirectory: join(dir, 'state') });
  expect(Object.keys(mink.getConfig().commands)).toEqual(
    expect.arrayContaining([
      'just:check',
      'procfile:web',
      'deno:lint',
      'cargo:test',
      'go:test',
      'python:hello',
    ]),
  );
  await mink.dispose();
});

it('wraps portable exec commands with ssh, docker and devcontainer runners', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: {
        ssh: command('', { runner: { type: 'ssh', target: 'host' } }),
        docker: command('', { runner: { type: 'docker', image: 'node:24' } }),
        container: command('', { runner: { type: 'devcontainer' } }),
      },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  expect(mink.prepare('ssh').executable).toBe('ssh');
  expect(mink.prepare('ssh').args.slice(0, 4)).toEqual(['host', process.execPath, '-e', '']);
  expect(mink.prepare('docker').args.slice(0, 4)).toEqual([
    'run',
    '--rm',
    'node:24',
    process.execPath,
  ]);
  expect(mink.prepare('container').executable).toBe('devcontainer');
  await mink.dispose();
});

it('provides typed config, plugin registries, templates and safe Git hook installation', async () => {
  expect(defineConfig({ version: 1 as const, commands: {} }).version).toBe(1);
  expect(createPluginRegistry().runners.size).toBe(0);
  const dir = await directory();
  await initTemplate('node', 'mink.yml', dir);
  await mkdir(join(dir, '.git/hooks'), { recursive: true });
  const files = await installGitHooks(dir, { preCommit: 'test' });
  await expect(access(files[0])).resolves.toBeUndefined();
  expect(await readFile(files[0], 'utf8')).toContain('--affected --since HEAD --only');
});
