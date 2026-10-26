import { expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMink } from '../packages/core/src/index.js';
import { MinkMcpServer } from '../packages/mcp/src/index.js';
import { command, directory } from './helpers.js';

it('exposes bounded MCP tools and enforces read-only and allow policies', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({
      version: 1,
      commands: {
        check: command('', { tags: ['safe'] }),
        deploy: command(''),
      },
    }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  const server = new MinkMcpServer(mink, { readOnly: true, allow: ['safe'], logLimit: 2 });
  const listed = (await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })) as {
    tools: Array<{ name: string }>;
  };
  expect(listed.tools.map((tool) => tool.name)).toContain('run');
  const denied = (await server.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'plan', arguments: { id: 'deploy' } },
  })) as { isError: boolean };
  expect(denied.isError).toBe(true);
  const readOnly = (await server.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'run', arguments: { id: 'check' } },
  })) as { isError: boolean };
  expect(readOnly.isError).toBe(true);
  await mink.dispose();
});

it('publishes graph and history resources plus the repair prompt', async () => {
  const dir = await directory();
  await writeFile(
    join(dir, 'mink.yml'),
    JSON.stringify({ version: 1, commands: { check: command('') } }),
  );
  const mink = await createMink({ cwd: dir, discover: false, stateDirectory: join(dir, 'state') });
  const server = new MinkMcpServer(mink);
  const graph = await server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: 'mink://graph' },
  });
  expect(JSON.stringify(graph)).toContain('check');
  const prompts = await server.handle({ jsonrpc: '2.0', id: 2, method: 'prompts/list' });
  expect(JSON.stringify(prompts)).toContain('fix-failed-step');
  await mink.dispose();
});
