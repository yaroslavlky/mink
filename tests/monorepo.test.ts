import { expect, it } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  analyzePlan,
  createMink,
  pruneWorkspace,
  workspaceGraph,
} from '../packages/core/src/index.js';
import { command, directory } from './helpers.js';

it('builds a workspace dependency graph and imports package scripts', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  );
  await mkdir(join(dir, 'packages/a'), { recursive: true });
  await mkdir(join(dir, 'packages/b'), { recursive: true });
  await writeFile(
    join(dir, 'packages/a/package.json'),
    JSON.stringify({ name: '@repo/a', scripts: { build: 'node a' } }),
  );
  await writeFile(
    join(dir, 'packages/b/package.json'),
    JSON.stringify({
      name: '@repo/b',
      dependencies: { '@repo/a': 'workspace:*' },
      scripts: { test: 'node b' },
    }),
  );
  const graph = await workspaceGraph(dir);
  expect(graph.find((item) => item.name === '@repo/b')?.dependencies).toEqual(['@repo/a']);
  const mink = await createMink({ cwd: dir, stateDirectory: join(dir, 'state') });
  expect(mink.getConfig().commands['packages/a:build']).toBeDefined();
  await mink.dispose();
});

it('composes namespaced configuration includes and rejects duplicate ambiguity', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'shared.yml'),
    JSON.stringify({ version: 1, commands: { check: command('') } }),
  );
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      includes: [{ path: 'shared.yml', namespace: 'tools' }],
      commands: { root: command('', { depends_on: ['tools:check'] }) },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  expect(mink.plan('root').dependencies[0].id).toBe('tools:check');
  await mink.dispose();
});

it('analyzes critical chains and prunes a package with workspace dependencies', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ private: true, workspaces: ['packages/*'] }),
  );
  for (const name of ['a', 'b']) await mkdir(join(dir, `packages/${name}`), { recursive: true });
  await writeFile(join(dir, 'packages/a/package.json'), JSON.stringify({ name: 'a' }));
  await writeFile(
    join(dir, 'packages/b/package.json'),
    JSON.stringify({ name: 'b', dependencies: { a: 'workspace:*' } }),
  );
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: { a: command(''), b: command('', { depends_on: ['a'] }) },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  expect(analyzePlan(mink.plan('b')).criticalChain).toEqual(['b', 'a']);
  expect(await pruneWorkspace(dir, 'b', 'pruned')).toEqual(['b', 'a']);
  await expect(access(join(dir, 'pruned/packages/a/package.json'))).resolves.toBeUndefined();
  expect(JSON.parse(await readFile(join(dir, 'pruned/.mink-prune.json'), 'utf8')).target).toBe('b');
  await mink.dispose();
});
