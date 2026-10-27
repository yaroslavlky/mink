import { expect, it } from 'vitest';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createMink,
  GlobalConfigStore,
  graphMermaid,
  shellCompletion,
} from '../packages/core/src/index.js';
import { command, directory } from './helpers.js';

it('layers profiles, OS overrides, env files, aliases, visibility and validators', async () => {
  const dir = await directory();
  await writeFile(join(dir, '.env'), 'TOKEN=first\nPUBLIC=one\n');
  await writeFile(join(dir, '.env.local'), 'TOKEN=second\n');
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      vars: { message: 'dev' },
      profiles: { ci: { vars: { message: 'ci' } } },
      commands: {
        build: command('', {
          aliases: ['b'],
          tags: ['check'],
          group: 'quality',
          args: ['-e', '', '--', '${message}'],
          [platform]: { args: ['-e', '', '--', '${message}-os'] },
          params: {
            count: { type: 'number', required: false, min: 1, max: 3 },
            name: { type: 'string', required: false, regex: '^[a-z]+$' },
          },
        }),
        hidden: command('', { hidden: true }),
        private: command('', { private: true }),
        workflow: {
          kind: 'pipeline',
          name: 'Workflow',
          steps: { private: { uses: 'private' } },
        },
      },
    }),
  );
  const mink = await createMink({
    cwd: dir,
    discover: false,
    profile: 'ci',
    stateDirectory: join(dir, 'state'),
  });
  expect(mink.prepare('b').args.at(-1)).toBe('ci-os');
  expect(mink.select('*', 'check', 'quality')).toEqual(['build']);
  expect(mink.searchCommands('').map((entry) => entry.id)).not.toContain('hidden');
  expect(mink.environment('build')).toMatchObject({ TOKEN: '[hidden]', PUBLIC: '[hidden]' });
  expect(() => mink.prepare('build', { count: 4 })).toThrow(/number/);
  expect(() => mink.plan('private')).toThrow(/private/);
  expect(mink.plan('workflow').steps.private.plan.id).toBe('private');
  await mink.dispose();
});

it('expands matrix steps and runs hooks, once steps, conditions and tolerated failures', async () => {
  const dir = await directory();
  const append = (value: string) =>
    command(`require("fs").appendFileSync("events",${JSON.stringify(value)})`);
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: {
        hook: append('H'),
        cleanup: append('F'),
        once: append('O'),
        item: command('require("fs").appendFileSync("events",process.env.VALUE)', {
          params: { value: { type: 'string', env: 'VALUE' } },
        }),
        bad: command('process.exit(2)'),
        after: append('A'),
        pipeline: {
          kind: 'pipeline',
          name: 'Pipeline',
          hooks: { before: 'hook', finally: 'cleanup' },
          steps: {
            matrix: {
              uses: 'item',
              matrix: { value: ['1', '2'] },
              with: { value: '${matrix.value}' },
              lock: 'events',
            },
            first: { uses: 'once', run: 'once' },
            second: { uses: 'once', run: 'once' },
            bad: { uses: 'bad', continue_on_error: true },
            after: {
              uses: 'after',
              needs: ['bad'],
              if: `os:${process.platform === 'win32' ? 'windows' : process.platform}`,
            },
          },
        },
      },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  const result = await mink.run('pipeline');
  expect(result.state).toBe('succeeded');
  const events = await readFile(join(dir, 'events'), 'utf8');
  for (const marker of ['H', 'F', 'O', 'A', '1', '2']) expect(events).toContain(marker);
  expect(events.match(/O/g)).toHaveLength(1);
  await mink.dispose();
});

it('restores cached output artifacts and exposes graph, shell and global config contracts', async () => {
  const dir = await directory();
  await writeFile(join(dir, 'input.txt'), 'source');
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: {
        build: command(
          'require("fs").appendFileSync("runs","x");require("fs").writeFileSync("out.txt","artifact")',
          {
            sources: ['input.txt'],
            outputs: ['out.txt'],
          },
        ),
        pipeline: { kind: 'pipeline', name: 'Pipeline', steps: { build: { uses: 'build' } } },
      },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  await mink.run('build');
  await rm(join(dir, 'out.txt'));
  expect((await mink.run('build')).cached).toBe(true);
  expect(await readFile(join(dir, 'out.txt'), 'utf8')).toBe('artifact');
  expect(await readFile(join(dir, 'runs'), 'utf8')).toBe('x');
  expect(graphMermaid(mink.graph())).toContain('flowchart TD');
  expect(shellCompletion('bash')).toContain('complete -F');
  const global = new GlobalConfigStore(join(dir, 'config'));
  await global.set('defaultProfile', 'ci');
  expect(await global.get('defaultProfile')).toBe('ci');
  await mink.dispose();
  await expect(access(join(dir, 'out.txt'))).resolves.toBeUndefined();
});
