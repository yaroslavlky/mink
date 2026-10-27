import { expect, it } from 'vitest';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createMink, SupervisorClient, SupervisorServer } from '../packages/core/src/index.js';
import { command, directory } from './helpers.js';

it.runIf(process.platform !== 'win32' && !process.env.CODEX_CI)(
  'serves status and history over the local supervisor socket',
  async () => {
    const dir = await directory();
    await writeFile(
      join(dir, 'mink.yml'),
      JSON.stringify({ version: 1, commands: { check: command('') } }),
    );
    const mink = await createMink({
      cwd: dir,
      discover: false,
      stateDirectory: join(dir, 'state'),
    });
    const server = new SupervisorServer(mink, join(dir, 'supervisor.sock'));
    await server.listen();
    const client = new SupervisorClient(server.endpoint);
    expect(await client.ping()).toEqual({ pid: process.pid });
    expect(await client.request<{ configFile: string }>({ action: 'status' })).toMatchObject({
      configFile: join(dir, 'mink.yml'),
    });
    expect(await client.request<unknown[]>({ action: 'history' })).toEqual([]);
    await server.close();
  },
);

it('normalizes conditional dependencies and replica service plans', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: {
        prepare: command(''),
        api: command('', {
          depends_on: [{ id: 'prepare', condition: 'completed_successfully', optional: true }],
          run: { mode: 'service', replicas: 2, ready_log_line: 'ready' },
        }),
      },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  const plan = mink.plan('api');
  expect(plan.dependencies.map((dependency) => dependency.id)).toEqual(['prepare']);
  expect(plan.dependencyRules[0]).toMatchObject({
    condition: 'completed_successfully',
    optional: true,
  });
  expect(plan.entry?.run?.replicas).toBe(2);
  await mink.dispose();
});
