import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import type { ExecutionPlan } from '../commands/plan.js';
import { redactSecrets } from './log.js';
import type { RunEvent, RunResult } from './process.js';

export interface CacheEntry {
  fingerprint: string;
  createdAt: number;
  result: RunResult;
  events: Array<Pick<RunEvent, 'type' | 'chunk'>>;
  artifacts?: Record<string, string>;
}
export interface CacheStatus {
  enabled: boolean;
  reason: string;
  fingerprint?: string;
  entry?: CacheEntry;
}
export interface CacheInfo {
  entries: number;
  size: number;
  oldest?: number;
  newest?: number;
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const succeeded = (result: RunResult) => result.state === 'succeeded';

export class CacheStore {
  private readonly root: string;
  private readonly events = new Map<string, Array<Pick<RunEvent, 'type' | 'chunk'>>>();
  private readonly statuses = new Map<string, CacheStatus>();
  private readonly baselines = new Map<string, Record<string, string>>();
  private readonly ttlMs: number;
  private readonly maxSize: number;
  constructor(
    directory: string,
    stateDirectory: string,
    options: { ttl_ms?: number; max_size_bytes?: number } = {},
  ) {
    this.root = join(stateDirectory, 'cache', hash(resolve(directory)));
    this.ttlMs = options.ttl_ms ?? 7 * 24 * 60 * 60 * 1000;
    this.maxSize = options.max_size_bytes ?? 512 * 1024 * 1024;
  }
  observe(event: RunEvent): void {
    if ((event.type === 'stdout' || event.type === 'stderr') && event.chunk)
      (
        this.events.get(event.instance) ?? this.events.set(event.instance, []).get(event.instance)!
      ).push({
        type: event.type,
        chunk: event.chunk,
      });
  }
  async lookup(plan: ExecutionPlan): Promise<CacheStatus> {
    const status = await this.status(plan);
    if (plan.entry?.outputs && !status.entry)
      this.baselines.set(plan.key, await this.snapshot(plan, plan.entry.outputs));
    if (status.entry?.artifacts) await this.restore(plan, status.entry.artifacts);
    this.statuses.set(plan.key, status);
    return status;
  }
  why(plan: ExecutionPlan): CacheStatus | undefined {
    return this.statuses.get(plan.key);
  }
  async store(plan: ExecutionPlan, instance: string, result: RunResult): Promise<void> {
    const status = this.statuses.get(plan.key);
    const events = this.events.get(instance) ?? [];
    this.events.delete(instance);
    if (!status?.enabled || !status.fingerprint || !succeeded(result)) return;
    const entry: CacheEntry = {
      fingerprint: status.fingerprint,
      createdAt: Date.now(),
      result: structuredClone(result),
      events: events.map((event) => ({
        ...event,
        ...(event.chunk ? { chunk: redactSecrets(event.chunk, plan) } : {}),
      })),
      ...(plan.entry?.outputs ? { artifacts: await this.artifacts(plan, plan.entry.outputs) } : {}),
    };
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(join(this.root, `${entry.fingerprint}.json`), JSON.stringify(entry), {
      mode: 0o600,
    });
    await this.prune();
  }
  async list(): Promise<CacheInfo> {
    const files = await this.files();
    const metadata = await Promise.all(files.map(async (file) => stat(file)));
    const times = metadata.map((item) => item.mtimeMs);
    return {
      entries: files.length,
      size: metadata.reduce((total, item) => total + item.size, 0),
      ...(times.length ? { oldest: Math.min(...times), newest: Math.max(...times) } : {}),
    };
  }
  async clear(): Promise<void> {
    await rm(this.root, { recursive: true, force: true });
  }
  async prune(): Promise<CacheInfo> {
    const now = Date.now();
    const records = await Promise.all(
      (await this.files()).map(async (file) => ({ file, stat: await stat(file) })),
    );
    let total = records.reduce((sum, record) => sum + record.stat.size, 0);
    for (const record of records.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) {
      if ((this.ttlMs > 0 && now - record.stat.mtimeMs > this.ttlMs) || total > this.maxSize) {
        total -= record.stat.size;
        await rm(record.file, { force: true });
      }
    }
    return this.list();
  }
  private async status(plan: ExecutionPlan): Promise<CacheStatus> {
    const entry = plan.entry;
    if (!entry || entry.run?.mode === 'service')
      return { enabled: false, reason: 'services are not cached' };
    if (!entry.sources?.length) return { enabled: false, reason: 'no sources configured' };
    const cwd = plan.prepared?.cwd ?? process.cwd();
    const files = await glob(entry.sources, { cwd, absolute: true, onlyFiles: true });
    const method = entry.cache?.method ?? 'checksum';
    const sources = await Promise.all(
      files.sort().map(async (file) => {
        const info = await stat(file);
        return [
          relative(cwd, file),
          method === 'timestamp' ? `${info.mtimeMs}:${info.size}` : hash(await readFile(file)),
        ] as const;
      }),
    );
    const secretEnvs = new Set(
      Object.values(entry.params ?? {})
        .filter((parameter) => parameter.type === 'secret')
        .map((parameter) => parameter.env)
        .filter((name): name is string => !!name),
    );
    const definition = {
      entry,
      prepared: {
        command: plan.prepared?.command,
        executable: plan.prepared?.executable,
        args: plan.prepared?.args,
        cwd: plan.prepared?.cwd,
        env: Object.fromEntries(
          Object.entries(plan.prepared?.env ?? {}).filter(([name]) => !secretEnvs.has(name)),
        ),
      },
      sources,
    };
    const fingerprint = hash(JSON.stringify(definition));
    try {
      const cached = JSON.parse(
        await readFile(join(this.root, `${fingerprint}.json`), 'utf8'),
      ) as CacheEntry;
      if (cached.fingerprint !== fingerprint || !succeeded(cached.result))
        return { enabled: true, reason: 'invalid cache record', fingerprint };
      if (this.ttlMs > 0 && Date.now() - cached.createdAt > this.ttlMs)
        return { enabled: true, reason: 'cache entry expired', fingerprint };
      return { enabled: true, reason: 'fingerprint matched', fingerprint, entry: cached };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { enabled: true, reason: 'no matching cache entry', fingerprint };
      return { enabled: true, reason: 'unreadable cache entry', fingerprint };
    }
  }
  private async artifacts(
    plan: ExecutionPlan,
    outputs: string[] | { auto: true },
  ): Promise<Record<string, string>> {
    const current = await this.snapshot(plan, outputs);
    const baseline = this.baselines.get(plan.key) ?? {};
    this.baselines.delete(plan.key);
    const selected = Array.isArray(outputs)
      ? Object.keys(current)
      : Object.keys(current).filter((path) => current[path] !== baseline[path]);
    const cwd = plan.prepared?.cwd ?? process.cwd();
    return Object.fromEntries(
      await Promise.all(
        selected.map(async (path) => [
          path,
          (await readFile(resolve(cwd, path))).toString('base64'),
        ]),
      ),
    );
  }
  private async snapshot(
    plan: ExecutionPlan,
    outputs: string[] | { auto: true },
  ): Promise<Record<string, string>> {
    const cwd = plan.prepared?.cwd ?? process.cwd();
    const patterns = Array.isArray(outputs) ? outputs : ['**/*'];
    const files = await glob(patterns, {
      cwd,
      absolute: true,
      onlyFiles: true,
      ignore: ['**/.git/**', '**/node_modules/**', '**/.mink/**'],
    });
    return Object.fromEntries(
      await Promise.all(
        files.sort().map(async (file) => [relative(cwd, file), hash(await readFile(file))]),
      ),
    );
  }
  private async restore(plan: ExecutionPlan, artifacts: Record<string, string>): Promise<void> {
    const cwd = resolve(plan.prepared?.cwd ?? process.cwd());
    for (const [path, encoded] of Object.entries(artifacts)) {
      const target = resolve(cwd, path);
      const child = relative(cwd, target);
      if (!child || child.startsWith('..') || isAbsolute(child))
        throw new Error(`Unsafe cached output path: ${path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(encoded, 'base64'));
    }
  }
  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.root))
        .filter((name) => name.endsWith('.json'))
        .map((name) => join(this.root, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
