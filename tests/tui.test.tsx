import { afterEach, expect, it, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { MinkApp } from '../packages/tui/src/app.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LogView } from '../packages/tui/src/components/log-view.js';
import { Input } from '../packages/tui/src/components/input.js';
import { safeText } from '../packages/tui/src/actions.js';
import { project, command } from './helpers.js';
afterEach(cleanup);

it('searches logs without firing rerun shortcuts while editing the query', async () => {
  const m = await project({
    logs: command('process.stdout.write("ordinary line\\nERROR: detail\\n")'),
  });
  const run = vi.spyOn(m, 'run');
  const ui = render(<MinkApp mink={m} overrides={{ language: 'en' }} />);
  await expect.poll(ui.lastFrame).toContain('COMMANDS');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('REVIEW BEFORE EXECUTION');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('ERROR: detail');
  await expect.poll(ui.lastFrame).toContain('Exit: 0');
  // Ink installs input listeners in passive effects after rendering the frame.
  await new Promise((resolve) => setTimeout(resolve, 50));
  ui.stdin.write('/');
  await expect.poll(ui.lastFrame).not.toContain('/ search');
  ui.stdin.write('r');
  await expect.poll(ui.lastFrame).toContain('/ r');
  ui.stdin.write('ror');
  await expect.poll(ui.lastFrame).toContain('/ rror');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).not.toContain('ordinary line');
  expect(ui.lastFrame()).toContain('ERROR: detail');
  expect(run).toHaveBeenCalledTimes(1);
  ui.stdin.write('/');
  await expect.poll(ui.lastFrame).toContain('/ rror');
  ui.stdin.write('\u001b');
  await expect.poll(ui.lastFrame).toContain('PROCESS OUTPUT');
});

it('filters the palette, edits parameters, previews and runs with output', async () => {
  const m = await project({
    greet: command('process.stdout.write("Hello "+process.env.NAME)', {
      params: { name: { type: 'string', env: 'NAME' } },
    }),
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('greet');
  await expect.poll(ui.lastFrame).toContain('Search › greet');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('name (string)');
  ui.stdin.write('Ada');
  await expect.poll(ui.lastFrame).toContain('Ada');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain("NAME='Ada'");
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('Exit: 0');
  // Ink installs input listeners in passive effects after rendering the frame.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(ui.lastFrame()).toContain('Hello Ada');
  ui.stdin.write('\u001b');
  await expect.poll(ui.lastFrame).toContain('Search');
});

it('shows keys on ? outside text input and applies session overrides', async () => {
  const m = await project({ a: command('') });
  const ui = render(<MinkApp mink={m} overrides={{ language: 'de' }} />);
  await expect.poll(ui.lastFrame).toContain('BEFEHLE');
  ui.stdin.write('?');
  await expect.poll(ui.lastFrame).toContain('Suche › ?');
  ui.stdin.write('\u000f');
  await expect.poll(ui.lastFrame).toContain('AUSGABE');
  ui.stdin.write('?');
  await expect.poll(ui.lastFrame).toContain('Tasten');
  ui.stdin.write('?');
  await expect.poll(ui.lastFrame).not.toContain('Tasten');
  ui.stdin.write('?');
  await expect.poll(ui.lastFrame).toContain('Tasten');
  ui.stdin.write('\u001b');
  await expect.poll(ui.lastFrame).not.toContain('Tasten');
});

it('masks secrets in input and command preview', async () => {
  const m = await project({
    a: command('', { params: { token: { type: 'secret', env: 'TOKEN' } } }),
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('secret');
  ui.stdin.write('private-token');
  await expect.poll(ui.lastFrame).toContain('•••');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('[hidden]');
  expect(ui.frames.join('\n')).not.toContain('private-token');
});

it('preserves boolean defaults and exposes ready services', async () => {
  const m = await project({
    server: command('setInterval(()=>{},100)', {
      params: { enabled: { type: 'boolean', default: true, env: 'ENABLED' } },
      run: { mode: 'service' },
    }),
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('Selected: true');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain("ENABLED='true'");
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('ready');
  ui.stdin.write('\u0013');
  await expect.poll(ui.lastFrame).toContain('SERVICE OUTPUT');
  ui.stdin.write('s');
  await expect.poll(ui.lastFrame).toContain('stopped');
});

it('edits at the cursor and strips terminal escape sequences', async () => {
  let value = '';
  const ui = render(
    <Input
      initial="ac"
      submit={(v) => {
        value = v;
      }}
    />,
  );
  await expect.poll(ui.lastFrame).toContain('ac');
  ui.stdin.write('\u001b[D');
  await new Promise((resolve) => setImmediate(resolve));
  ui.stdin.write('b');
  await expect.poll(ui.lastFrame).toContain('abc');
  ui.stdin.write('\r');
  await expect.poll(() => value).toBe('abc');
  expect(safeText('\u001b[31mred\u001b[0m\u001b]0;title\u0007\r\n')).toBe('red\n');
});

it('prioritizes an exact command ID and keeps navigation separate from search input', async () => {
  const m = await project({ test: command(''), 'test:watch': command('') });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('COMMANDS');
  ui.stdin.write('test');
  await expect.poll(ui.lastFrame).toContain('› test ·');
  ui.stdin.write('\u000f');
  await expect.poll(ui.lastFrame).toContain('No invocation yet');
  ui.stdin.write('\u0010');
  await expect.poll(ui.lastFrame).toContain('Search › test');
  ui.stdin.write('\u0015');
  await expect.poll(ui.lastFrame).not.toContain('Search › test');
});

it('cycles tabs in both directions and preserves palette search and selection', async () => {
  const m = await project({ alpha: command(''), beta: command('') });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('a');
  await expect.poll(ui.lastFrame).toContain('Search › a');
  ui.stdin.write('\u001b[B');
  await expect.poll(ui.lastFrame).toContain('› beta');
  for (const title of ['No invocation yet', 'No services started.', 'SETTINGS', 'Search › a']) {
    ui.stdin.write('\t');
    await expect.poll(ui.lastFrame).toContain(title);
  }
  expect(ui.lastFrame()).toContain('› beta');
  for (const title of ['SETTINGS', 'No services started.', 'No invocation yet', 'Search › a']) {
    ui.stdin.write('\u001b[Z');
    await expect.poll(ui.lastFrame).toContain(title);
  }
  expect(ui.lastFrame()).toContain('› beta');
});

it('keeps unfinished text and selected choices when tabbing away from a parameter form', async () => {
  const m = await project({
    greet: command('', {
      params: {
        name: { type: 'string', env: 'NAME' },
        environment: { type: 'select', options: ['dev', 'prod'], env: 'ENVIRONMENT' },
        enabled: { type: 'boolean', default: true, env: 'ENABLED' },
      },
    }),
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('name (string)');
  ui.stdin.write('Ada');
  await expect.poll(ui.lastFrame).toContain('Ada');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('No invocation yet');
  ui.stdin.write('unrelated');
  await new Promise((resolve) => setImmediate(resolve));
  ui.stdin.write('\u001b[Z');
  await expect.poll(ui.lastFrame).toContain('name (string)');
  expect(ui.lastFrame()).toContain('Ada');
  expect(ui.lastFrame()).not.toContain('unrelated');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('environment (select)');
  ui.stdin.write('\u001b[B');
  await expect.poll(ui.lastFrame).toContain('Selected: prod');
  ui.stdin.write('\u001b[Z');
  await expect.poll(ui.lastFrame).toContain('SETTINGS');
  ui.stdin.write('\u001b[Z');
  await expect.poll(ui.lastFrame).toContain('No services started.');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('SETTINGS');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('environment (select)');
  expect(ui.lastFrame()).toContain('Selected: prod');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('enabled (boolean)');
  ui.stdin.write('\u0002');
  await expect.poll(ui.lastFrame).toContain('environment (select)');
  expect(ui.lastFrame()).toContain('Selected: prod');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('enabled (boolean)');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain("NAME='Ada'");
  expect(ui.lastFrame()).toContain("ENVIRONMENT='prod'");
});

it('keeps hidden output and service shortcuts inactive', async () => {
  const m = await project({
    server: command('setInterval(()=>{},100)', { run: { mode: 'service' } }),
  });
  const stop = vi.spyOn(m, 'stopService'),
    restart = vi.spyOn(m, 'restartService'),
    run = vi.spyOn(m, 'run');
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('REVIEW BEFORE EXECUTION');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('ready');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('SERVICE OUTPUT');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('SETTINGS');
  ui.stdin.write('\t');
  await expect.poll(ui.lastFrame).toContain('REVIEW BEFORE EXECUTION');
  ui.stdin.write('\u0010');
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('rsk');
  await expect.poll(ui.lastFrame).toContain('Search › rsk');
  expect(stop).not.toHaveBeenCalled();
  expect(restart).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);
  ui.stdin.write('\u001b[Z');
  await expect.poll(ui.lastFrame).toContain('SETTINGS');
  ui.stdin.write('\u001b[Z');
  await expect.poll(ui.lastFrame).toContain('SERVICE OUTPUT');
  ui.stdin.write('s');
  await expect.poll(ui.lastFrame).toContain('stopped');
  expect(stop).toHaveBeenCalledTimes(1);
});

it('adapts boxed panels to terminal resize without overflowing the viewport', async () => {
  const m = await project({
    a: command('', {
      description: 'A long description '.repeat(20),
      params: { name: { type: 'string', default: 'Ada' } },
    }),
  });
  const ui = render(<MinkApp mink={m} />);
  Object.defineProperty(ui.stdout, 'columns', { configurable: true, value: 120 });
  Object.defineProperty(ui.stdout, 'rows', { configurable: true, value: 32 });
  ui.stdout.emit('resize');
  await expect
    .poll(() =>
      ui
        .lastFrame()
        ?.split('\n')
        .some((line) => line.includes('COMMANDS') && line.includes('DETAILS')),
    )
    .toBe(true);
  Object.defineProperty(ui.stdout, 'columns', { configurable: true, value: 60 });
  Object.defineProperty(ui.stdout, 'rows', { configurable: true, value: 24 });
  ui.stdout.emit('resize');
  await expect
    .poll(() => Math.max(...(ui.lastFrame() ?? '').split('\n').map((line) => line.length)))
    .toBeLessThanOrEqual(60);
  expect(ui.lastFrame()!.split('\n').length).toBeLessThanOrEqual(24);
});

it('shows failed and skipped workflow stages in the compact output layout', async () => {
  const m = await project({
    fail: command('process.exit(3)'),
    skip: command(''),
    workflow: {
      kind: 'pipeline',
      name: 'Workflow',
      steps: { first: { uses: 'fail' }, later: { uses: 'skip', needs: ['first'] } },
    },
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('workflow');
  await expect.poll(ui.lastFrame).toContain('› workflow');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('← first');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('skipped');
  expect(ui.lastFrame()).toContain('failed');
});

it('pauses log following while scrolling and resumes on End', async () => {
  const lines = Array.from({ length: 40 }, (_, index) => ({
    key: String(index),
    id: 'task',
    stream: 'stdout' as const,
    text: `line-${index}`,
  }));
  const ui = render(<LogView lines={lines} height={8} truncated={false} />);
  await expect.poll(ui.lastFrame).toContain('line-39');
  ui.stdin.write('\u001b[5~');
  await expect.poll(ui.lastFrame).toContain('PAUSED');
  const first = ui.lastFrame()!.split('\n')[0];
  ui.rerender(
    <LogView
      lines={[...lines, { key: '40', id: 'task', stream: 'stdout', text: 'line-40' }]}
      height={8}
      truncated={false}
    />,
  );
  await expect.poll(() => ui.lastFrame()?.split('\n')[0]).toBe(first);
  ui.stdin.write('\u001b[F');
  await expect.poll(ui.lastFrame).toContain('line-40');
  expect(ui.lastFrame()).toContain('LIVE');
});

it('scrolls logs with the mouse wheel only inside the active pane and resumes following at the tail', async () => {
  const lines = Array.from({ length: 40 }, (_, index) => ({
    key: String(index),
    id: 'task',
    stream: 'stdout' as const,
    text: `line-${index}`,
  }));
  const ui = render(<LogView lines={lines} height={8} truncated={false} />);
  await expect.poll(ui.lastFrame).toContain('35–40/40');
  await new Promise((resolve) => setTimeout(resolve, 50));
  ui.stdin.write('\u001b[<64;1;10M');
  expect(ui.lastFrame()).toContain('LIVE');
  ui.stdin.write('\u001b[<64;1;3M');
  await expect.poll(ui.lastFrame).toContain('32–37/40');
  expect(ui.lastFrame()).toContain('PAUSED');
  ui.stdin.write('\u001b[<65;1;3M');
  await expect.poll(ui.lastFrame).toContain('35–40/40');
  expect(ui.lastFrame()).toContain('LIVE');
  ui.stdin.write('\u001b[<64;');
  ui.stdin.write('1;3M\u001b[<64;1;3M');
  await expect.poll(ui.lastFrame).toContain('29–34/40');
  ui.rerender(<LogView active={false} lines={lines} height={8} truncated={false} />);
  await new Promise((resolve) => setTimeout(resolve, 50));
  ui.stdin.write('\u001b[<64;1;3M');
  expect(ui.lastFrame()).toContain('29–34/40');
});

it('reruns the last invocation after inspecting a different command', async () => {
  const m = await project({
    alpha: command('require("fs").appendFileSync("runs", "a")'),
    beta: command('require("fs").appendFileSync("runs", "b")'),
  });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('alpha');
  await expect.poll(ui.lastFrame).toContain('› alpha');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('REVIEW BEFORE EXECUTION');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('Exit: 0');
  // Ink installs input listeners in passive effects after rendering the frame.
  await new Promise((resolve) => setTimeout(resolve, 50));
  ui.stdin.write('\u0010');
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\u0015');
  await expect.poll(ui.lastFrame).not.toContain('Search › alpha');
  ui.stdin.write('beta');
  await expect.poll(ui.lastFrame).toContain('› beta');
  ui.stdin.write('\r');
  await expect.poll(ui.lastFrame).toContain('REVIEW BEFORE EXECUTION');
  ui.stdin.write('\u000f');
  await expect.poll(ui.lastFrame).toContain('INVOCATION');
  ui.stdin.write('r');
  await expect.poll(async () => readFile(join(m.directory, 'runs'), 'utf8')).toBe('aa');
  await expect.poll(ui.lastFrame).toContain('Exit: 0');
  // Ink installs input listeners in passive effects after rendering the frame.
  await new Promise((resolve) => setTimeout(resolve, 50));
});

it('switches theme and language from settings', async () => {
  const m = await project({ alpha: command('') });
  const ui = render(<MinkApp mink={m} />);
  await expect.poll(ui.lastFrame).toContain('Search');
  ui.stdin.write('\u0007');
  await expect.poll(ui.lastFrame).toContain('SETTINGS');
  ui.stdin.write('\u001b[C');
  await expect.poll(ui.lastFrame).toContain('Sand');
  ui.stdin.write('\u001b[B');
  await new Promise((resolve) => setImmediate(resolve));
  ui.stdin.write('\u001b[C');
  await expect.poll(ui.lastFrame).toContain('Русский');
  ui.stdin.write('\u001b');
  await expect.poll(ui.lastFrame).toContain('Поиск');
});
