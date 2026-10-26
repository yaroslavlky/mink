import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile, rename, stat, writeFile, unlink } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import type { ParameterValue } from './commands/resolve.js';
export interface HistoryEntry {
  id: string;
  time: string;
  state: string;
  durationMs: number;
}
export const themes = [
  'mink',
  'slate',
  'stone',
  'sand',
  'graphite',
  'mono',
  'forest',
  'amber',
  'violet',
] as const;
export type ThemeName = (typeof themes)[number];
export const languages = ['en', 'ru', 'de', 'fr', 'zh'] as const;
export type Language = (typeof languages)[number];
export interface Settings {
  theme: ThemeName;
  language: Language;
}
export const defaultSettings: Settings = { theme: 'stone', language: 'en' };

export function detectLanguage(locale = process.env.LC_ALL || process.env.LANG || ''): Language {
  const code = locale.split(/[._@-]/)[0]?.toLowerCase();
  return languages.find((language) => language === code) ?? defaultSettings.language;
}
export interface LocalState {
  history: HistoryEntry[];
  favorites: string[];
  presets: Record<string, Record<string, Record<string, ParameterValue>>>;
}
const fresh = (): LocalState => ({ history: [], favorites: [], presets: {} });

const fallbackSettings = (): Settings => ({
  theme: defaultSettings.theme,
  language: detectLanguage(),
});
export function stateRoot(directory?: string): string {
  return (
    directory ??
    (process.env.XDG_STATE_HOME
      ? join(process.env.XDG_STATE_HOME, 'mink')
      : process.platform === 'win32'
        ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'mink')
        : process.platform === 'darwin'
          ? join(homedir(), 'Library', 'Application Support', 'mink')
          : join(homedir(), '.local', 'state', 'mink'))
  );
}
export class SettingsStore {
  readonly file: string;
  constructor(directory?: string) {
    this.file = join(stateRoot(directory), 'settings.json');
  }
  async read(): Promise<Settings> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object') return fallbackSettings();
      const value = data as Partial<Settings>;
      return {
        theme: themes.includes(value.theme as ThemeName)
          ? (value.theme as ThemeName)
          : defaultSettings.theme,
        language: languages.includes(value.language as Language)
          ? (value.language as Language)
          : detectLanguage(),
      };
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return fallbackSettings();
      throw error;
    }
  }
  async update(change: (settings: Settings) => void): Promise<Settings> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.file, {
      realpath: false,
      retries: { retries: 30, minTimeout: 20, maxTimeout: 100 },
      stale: 10000,
    });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const settings = await this.read();
      change(settings);
      await writeFile(temporary, JSON.stringify(settings) + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
      return settings;
    } finally {
      await unlink(temporary).catch(() => {});
      await release();
    }
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
function presets(value: unknown): LocalState['presets'] {
  if (!record(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entries]) => record(entries))
      .map(([id, entries]) => [
        id,
        Object.fromEntries(
          Object.entries(entries as Record<string, unknown>).filter(
            ([, values]) =>
              record(values) &&
              Object.values(values).every(
                (value) =>
                  typeof value === 'string' ||
                  typeof value === 'boolean' ||
                  (typeof value === 'number' && Number.isFinite(value)),
              ),
          ),
        ),
      ]),
  ) as LocalState['presets'];
}
export class StateStore {
  readonly file: string;
  constructor(project: string, directory?: string) {
    this.file = join(
      stateRoot(directory),
      createHash('sha256').update(resolve(project)).digest('hex') + '.json',
    );
  }
  async read(): Promise<LocalState> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!data || typeof data !== 'object') return fresh();
      const d = data as LocalState;
      return {
        history: Array.isArray(d.history)
          ? d.history
              .filter(
                (h) =>
                  h &&
                  typeof h.id === 'string' &&
                  typeof h.time === 'string' &&
                  typeof h.state === 'string' &&
                  typeof h.durationMs === 'number',
              )
              .slice(0, 100)
          : [],
        favorites: Array.isArray(d.favorites)
          ? d.favorites.filter((v) => typeof v === 'string')
          : [],
        presets: presets(d.presets),
      };
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return fresh();
      throw error;
    }
  }
  async update(change: (state: LocalState) => void): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.file, {
      realpath: false,
      retries: { retries: 30, minTimeout: 20, maxTimeout: 100 },
      stale: 10000,
    });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const state = await this.read();
      change(state);
      await writeFile(temporary, JSON.stringify(state) + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
      await release();
    }
  }
}

export interface TrustStatus {
  trusted: boolean;
  changed: boolean;
  foreign: boolean;
}
export class TrustStore {
  readonly file: string;
  constructor(
    private readonly configFile: string,
    directory?: string,
  ) {
    this.file = join(stateRoot(directory), 'trust.json');
  }
  async status(): Promise<TrustStatus> {
    const [content, metadata, records] = await Promise.all([
      readFile(this.configFile),
      stat(this.configFile),
      this.read(),
    ]);
    const key = resolve(this.configFile),
      fingerprint = createHash('sha256').update(content).digest('hex'),
      saved = records[key];
    return {
      trusted: saved === fingerprint,
      changed: saved !== undefined && saved !== fingerprint,
      foreign:
        process.platform !== 'win32' && typeof process.getuid === 'function'
          ? metadata.uid !== process.getuid()
          : false,
    };
  }
  async trust(): Promise<TrustStatus> {
    const content = await readFile(this.configFile);
    const fingerprint = createHash('sha256').update(content).digest('hex');
    await this.update((records) => {
      records[resolve(this.configFile)] = fingerprint;
    });
    return this.status();
  }
  async untrust(): Promise<void> {
    await this.update((records) => {
      delete records[resolve(this.configFile)];
    });
  }
  async assertTrusted(): Promise<void> {
    const status = await this.status();
    if (!status.foreign) return;
    if (status.changed)
      throw new Error(
        'Configuration changed since it was trusted; inspect it and run mink trust again',
      );
    if (!status.trusted)
      throw new Error('Foreign configuration is not trusted; inspect it and run mink trust');
  }
  private async read(): Promise<Record<string, string>> {
    try {
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!record(data)) return {};
      const entries = Object.entries(data).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      );
      return Object.fromEntries(entries);
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return {};
      throw error;
    }
  }
  private async update(change: (records: Record<string, string>) => void): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.file, {
      realpath: false,
      retries: { retries: 30, minTimeout: 20, maxTimeout: 100 },
      stale: 10000,
    });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const records = await this.read();
      change(records);
      await writeFile(temporary, JSON.stringify(records) + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
      await release();
    }
  }
}

export interface GlobalConfig {
  defaultProfile?: string;
  output?: 'prefix' | 'interleave' | 'grouped' | 'quiet' | 'timed';
  cacheTtlMs?: number;
  cacheMaxSizeBytes?: number;
}
function configRoot(directory?: string): string {
  return (
    directory ??
    (process.env.XDG_CONFIG_HOME
      ? join(process.env.XDG_CONFIG_HOME, 'mink')
      : process.platform === 'win32'
        ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'mink')
        : join(homedir(), '.config', 'mink'))
  );
}
export class GlobalConfigStore {
  readonly file: string;
  constructor(directory?: string) {
    this.file = join(configRoot(directory), 'config.json');
  }
  async read(): Promise<GlobalConfig> {
    try {
      const value: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      return record(value) ? (value as GlobalConfig) : {};
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
        return {};
      throw error;
    }
  }
  async get(key: keyof GlobalConfig): Promise<GlobalConfig[keyof GlobalConfig]> {
    return (await this.read())[key];
  }
  async set(key: keyof GlobalConfig, value: GlobalConfig[keyof GlobalConfig]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const current = await this.read();
    if (value === undefined) delete current[key];
    else Object.assign(current, { [key]: value });
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
