import { describe, it, expect } from 'vitest';
import { writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { createMink, validateConfig, commandLine } from '../packages/core/src/index.js';
import { StateStore } from '../packages/core/src/storage.js';
import { directory, project, command } from './helpers.js';

describe('configuration and parameters', () => {
  it('rejects cycles, invalid defaults, invalid env and unknown with parameters', () => {
    expect(() =>
      validateConfig({ version: 1, commands: { a: command('', { depends_on: ['a'] }) } }),
    ).toThrow(/cycle/);
    expect(() =>
      validateConfig({
        version: 1,
        commands: { a: command('', { params: { n: { type: 'number', default: 'x' } } }) },
      }),
    ).toThrow();
    expect(() =>
      validateConfig({
        version: 1,
        commands: { a: command('', { params: { x: { type: 'string', env: 'A=B' } } }) },
      }),
    ).toThrow(/env/);
    expect(() =>
      validateConfig({
        version: 1,
        commands: {
          a: command(''),
          p: { kind: 'pipeline', name: 'p', steps: { a: { uses: 'a', with: { bad: 'x' } } } },
        },
      }),
    ).toThrow(/unknown target/);
  });
  it('rejects unsafe secret defaults and presets', () => {
    expect(() =>
      validateConfig({
        version: 1,
        commands: {
          a: command('', { params: { key: { type: 'secret', env: 'KEY', default: 'bad' } } }),
        },
      }),
    ).toThrow();
    expect(() =>
      validateConfig({
        version: 1,
        commands: {
          a: command('', {
            params: { key: { type: 'secret', env: 'KEY' } },
            presets: { x: { key: 'bad' } },
          }),
        },
      }),
    ).toThrow(/secret/i);
  });
  it('handles conditional params and validates port and boolean values', async () => {
    const mink = await project({
      a: command('', {
        params: {
          enabled: { type: 'boolean', default: false },
          port: { type: 'port', when: { param: 'enabled', equals: true }, flag: '--port' },
        },
      }),
    });
    expect(mink.prepare('a').args.slice(3)).toEqual([]);
    expect(() => mink.prepare('a', { enabled: true })).toThrow(/missing/);
    expect(() => mink.prepare('a', { port: 10 })).toThrow(/inactive/);
    expect(() => mink.prepare('a', { enabled: true, port: 65536 })).toThrow(/port/);
    expect(mink.prepare('a', { enabled: true, port: 80 }).args.slice(3)).toEqual(['--port', '80']);
  });
  it('checks all parameters before executing a dependency', async () => {
    const mink = await project({
      dep: command('require("fs").writeFileSync("side-effect", "bad")'),
      root: command('', {
        depends_on: ['dep'],
        params: { value: { type: 'string', env: 'VALUE' } },
      }),
    });
    await expect(mink.run('root')).rejects.toThrow(/missing parameter/);
    await expect(access(join(mink.directory, 'side-effect'))).rejects.toThrow();
  });
  it('passes shell metacharacters as literal arguments and preserves output', async () => {
    const mink = await project({
      a: command('process.stdout.write(process.argv[2]);process.stderr.write("error\\n\\n")', {
        params: { value: { type: 'string', flag: '--value' } },
      }),
    });
    const chunks: string[] = [],
      errors: string[] = [];
    const payload = "space ' $(touch BAD)\nЮникод";
    const r = await mink.run(
      'a',
      { value: payload },
      {
        onEvent: (e) => {
          if (e.type === 'stdout') chunks.push(e.chunk!);
          if (e.type === 'stderr') errors.push(e.chunk!);
        },
      },
    );
    expect(r.exitCode).toBe(0);
    expect(chunks.join('')).toBe(payload);
    expect(errors.join('')).toBe('error\n\n');
    await expect(access(join(mink.directory, 'BAD'))).rejects.toThrow();
  });
  it('copies public configuration and search results', async () => {
    const m = await project({ a: command('') });
    m.getConfig().commands.a.name = 'changed';
    m.searchCommands('')[0].entry.name = 'changed';
    expect(m.getConfig().commands.a.name).toBe('Test command');
    expect(() => m.searchCommands('', 0)).toThrow();
    expect(commandLine(m.prepare('a'))).toContain('-e');
  });
  it('replays successful cached output and invalidates it when sources change', async () => {
    const m = await project({
      build: command('require("fs").appendFileSync("runs", "x");process.stdout.write("built")', {
        sources: ['input.txt'],
        outputs: { auto: true },
      }),
    });
    await writeFile(join(m.directory, 'input.txt'), 'one');
    expect((await m.run('build')).cached).toBeUndefined();
    expect((await m.run('build')).cached).toBe(true);
    expect(await readFile(join(m.directory, 'runs'), 'utf8')).toBe('x');
    await writeFile(join(m.directory, 'input.txt'), 'two');
    await m.run('build');
    expect(await readFile(join(m.directory, 'runs'), 'utf8')).toBe('xx');
    expect((await m.why('build'))[0].reason).toBe('fingerprint matched');
  });
  it('records trust by config hash and notices a later change', async () => {
    const m = await project({ build: command('') });
    expect((await m.trustStatus()).trusted).toBe(false);
    await m.trust();
    expect((await m.trustStatus()).trusted).toBe(true);
    await writeFile(m.configFile, '{"version":1,"commands":{}}');
    expect((await m.trustStatus()).changed).toBe(true);
    await m.untrust();
    expect((await m.trustStatus()).trusted).toBe(false);
  });
});

describe('discovery', () => {
  it('discovers workspaces from nested directories, preserves cwd and lets YAML override', async () => {
    const dir = await directory();
    await mkdir(join(dir, 'packages/app/nested'), { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        packageManager: 'npm@11',
        scripts: { test: 'echo root' },
        workspaces: ['packages/*'],
      }),
    );
    await writeFile(
      join(dir, 'packages/app/package.json'),
      JSON.stringify({ scripts: { test: 'echo app' } }),
    );
    await writeFile(
      join(dir, 'mink.yml'),
      JSON.stringify({
        version: 1,
        commands: { test: command('process.stdout.write("override")') },
      }),
    );
    const m = await createMink({
      cwd: join(dir, 'packages/app/nested'),
      stateDirectory: join(dir, 'state'),
    });
    const overridden = m.getConfig().commands.test;
    expect(overridden.kind === 'command' && overridden.args?.[1]).toContain('override');
    expect(m.getConfig().commands['packages/app:test'].kind).toBe('command');
    expect(m.prepare('packages/app:test').cwd).toBe(join(dir, 'packages/app'));
    await m.dispose();
  });
  it('supports package scripts without YAML and refuses malformed found YAML', async () => {
    const dir = await directory();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { hi: 'echo hi' } }));
    const m = await createMink({ cwd: dir });
    expect(m.searchCommands('hi')).toHaveLength(1);
    await m.dispose();
    await writeFile(join(dir, 'mink.yml'), 'version: nope');
    await expect(createMink({ cwd: dir })).rejects.toThrow(/Invalid/);
  });
});

describe('workflows and processes', () => {
  it('runs nested DAGs at a global limit of one without deadlock and deduplicates dependencies', async () => {
    const m = await project({
      dep: command('require("fs").appendFileSync("count","x")'),
      a: command('process.stdout.write("a")', { depends_on: ['dep'] }),
      b: command('process.stdout.write("b")', { depends_on: ['dep'] }),
      inner: { kind: 'pipeline', name: 'inner', steps: { a: { uses: 'a' }, b: { uses: 'b' } } },
      root: {
        kind: 'pipeline',
        name: 'root',
        max_parallel: 1,
        steps: { one: { uses: 'inner' }, two: { uses: 'a', needs: ['one'] } },
      },
    });
    expect((await m.run('root')).exitCode).toBe(0);
    expect(await readFile(join(m.directory, 'count'), 'utf8')).toBe('x');
  });
  it('skips dependents of a failure but completes independent branches', async () => {
    const m = await project({
      bad: command('process.exit(7)'),
      ok: command(''),
      p: {
        kind: 'pipeline',
        name: 'p',
        steps: { bad: { uses: 'bad' }, skip: { uses: 'ok', needs: ['bad'] }, ok: { uses: 'ok' } },
      },
    });
    const r = await m.run('p');
    expect(r.state).toBe('failed');
    expect(r.steps?.skip.state).toBe('skipped');
    expect(r.steps?.ok.state).toBe('succeeded');
  });
  it('resolves typed pipeline references before execution', async () => {
    const m = await project({
      a: command('process.stdout.write(process.env.PORT)', {
        params: { port: { type: 'port', env: 'PORT' } },
      }),
      p: {
        kind: 'pipeline',
        name: 'p',
        params: { port: { type: 'port', default: 4567 } },
        steps: { a: { uses: 'a', with: { port: '${params.port}' } } },
      },
    });
    let out = '';
    expect(
      (
        await m.run(
          'p',
          {},
          {
            onEvent: (e) => {
              if (e.type === 'stdout') out += e.chunk;
            },
          },
        )
      ).exitCode,
    ).toBe(0);
    expect(out).toBe('4567');
  });
  it('times out SIGTERM-resistant descendants', async () => {
    const m = await project({
      a: command('process.on("SIGTERM",()=>{});setInterval(()=>{},100)', {
        run: { timeout_ms: 100 },
      }),
    });
    const r = await m.run('a');
    expect(r.timedOut).toBe(true);
    expect(r.durationMs).toBeLessThan(process.platform === 'win32' ? 15000 : 3000);
  });
  it('cancels a queued pipeline and its running process', async () => {
    const m = await project({
      a: command('setInterval(()=>{},100)'),
      p: {
        kind: 'pipeline',
        name: 'p',
        max_parallel: 1,
        steps: { a: { uses: 'a' }, b: { uses: 'a' } },
      },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const r = await m.run('p', {}, { signal: controller.signal });
    expect(r.state).toBe('cancelled');
    expect(r.steps?.b.state).toBe('cancelled');
  });
  it('accepts process readiness and stops the owned service', async () => {
    const m = await project({
      server: command(
        'require("http").createServer((q,r)=>r.end("ok")).listen(0,"127.0.0.1",function(){process.stdout.write(String(this.address().port))})',
        { run: { mode: 'service', ready: { type: 'process' } } },
      ),
    });
    const r = await m.run('server');
    expect(r.state).toBe('ready');
    const service = m.services()[0];
    expect(service.state).toBe('ready');
    await m.stopService(service.instance);
    expect(m.services()[0].state).toBe('stopped');
  });
  it('fails startup for a service that never becomes ready', async () => {
    const m = await project({
      server: command('setInterval(()=>{},100)', {
        run: {
          mode: 'service',
          startup_timeout_ms: 100,
          ready: { type: 'http', url: 'http://127.0.0.1:1' },
        },
      }),
    });
    const r = await m.run('server');
    expect(r.state).toBe('failed');
    expect(r.timedOut).toBe(true);
  });
});

describe('local state', () => {
  it('merges concurrent updates, bounds history and recovers malformed JSON', async () => {
    const dir = await directory(),
      s = new StateStore(dir, join(dir, 'state'));
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        s.update((v) => {
          v.favorites.push(String(i));
        }),
      ),
    );
    expect((await s.read()).favorites).toHaveLength(8);
    await writeFile(s.file, 'bad');
    expect((await s.read()).history).toEqual([]);
  });
  it('keeps params out of history and rejects saving secrets', async () => {
    const m = await project({
      a: command('', { params: { token: { type: 'secret', env: 'TOKEN' } } }),
    });
    await m.run('a', { token: 'super-secret' });
    expect(JSON.stringify(await m.state())).not.toContain('super-secret');
    await expect(m.savePreset('a', 'x', { token: 'super-secret' })).rejects.toThrow(/Secret/);
  });
});
