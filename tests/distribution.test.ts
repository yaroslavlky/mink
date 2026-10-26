import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateCi, writeJunit } from '../packages/core/src/index.js';
import { directory } from './helpers.js';

it('generates deterministic GitHub and GitLab CI using Node 24', () => {
  expect(generateCi('github', 'verify')).toContain('mink ci run verify --github-summary');
  expect(generateCi('github')).toContain('node-version: 24');
  expect(generateCi('gitlab', 'verify')).toContain('junit: mink-junit.xml');
});

it('writes escaped JUnit without overwriting an existing report', async () => {
  const dir = await directory();
  const file = join(dir, 'junit.xml');
  await writeJunit(file, 'test<&', {
    state: 'failed',
    exitCode: 1,
    signal: null,
    durationMs: 1250,
    timedOut: false,
    error: 'bad <value>',
  });
  expect(await readFile(file, 'utf8')).toContain('name="test&lt;&amp;"');
  await expect(
    writeJunit(file, 'test', {
      state: 'succeeded',
      exitCode: 0,
      signal: null,
      durationMs: 1,
      timedOut: false,
    }),
  ).rejects.toMatchObject({ code: 'EEXIST' });
});

it('ships SEA, Homebrew, Scoop, winget and VS Code manifests', async () => {
  for (const file of [
    'packaging/sea-config.json',
    'packaging/homebrew/mink.rb',
    'packaging/scoop/mink.json',
    'packaging/winget/Yaroslavlky.Mink.yaml',
    'packages/vscode/package.json',
  ])
    expect((await readFile(file, 'utf8')).length).toBeGreaterThan(40);
});
