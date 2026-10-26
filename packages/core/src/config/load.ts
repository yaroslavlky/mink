import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Ajv } from 'ajv';
import { load } from 'js-yaml';
import schema from '../../schema/mink.schema.json' with { type: 'json' };
import type { MinkConfiguration } from '../types/schema.js';
import { validateReferences } from './validate.js';
import { discover, findUp } from './discover.js';
import { exists } from './discover.js';
import { projectFiles } from './import.js';
const validateShape = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
}).compile<MinkConfiguration>(schema);
export interface LoadedConfig {
  file: string;
  directory: string;
  config: MinkConfiguration;
  discovered: boolean;
  environment: Record<string, string>;
  hiddenEnvironment: string[];
}
export function validateConfig(value: unknown): asserts value is MinkConfiguration {
  if (!validateShape(value))
    throw new Error(
      `Invalid Mink configuration: ${validateShape.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`,
    );
  validateReferences(value);
}
export async function loadConfig(
  file?: string,
  cwd = process.cwd(),
  discovery = true,
  profile?: string,
): Promise<LoadedConfig> {
  const found = file ? resolve(cwd, file) : await findUp('mink.yml', cwd);
  let packageFile: string | undefined;
  if (!found && discovery) {
    outer: for (let directory = resolve(cwd); ; directory = dirname(directory)) {
      for (const marker of projectFiles)
        if (await exists(join(directory, marker))) {
          packageFile = join(directory, marker);
          break outer;
        }
      if (dirname(directory) === directory) break;
    }
  }
  const directory = found ? dirname(found) : packageFile ? dirname(packageFile) : resolve(cwd);
  let config: MinkConfiguration = { version: 1, commands: {} };
  if (found) {
    const parsed: unknown = load(await readFile(found, 'utf8'));
    validateConfig(parsed);
    config = parsed;
  }
  if (discovery) config.commands = { ...(await discover(directory)), ...config.commands };
  if (!found && !Object.keys(config.commands).length)
    throw new Error(`No mink.yml or discoverable commands in ${directory}; run mink init`);
  config = applyProfileAndPlatform(config, profile);
  validateConfig(config);
  const environment = await loadEnvironment(directory, config.env_file);
  return {
    file: found ?? join(directory, 'mink.yml'),
    directory,
    config,
    discovered: !found,
    environment,
    hiddenEnvironment: Object.keys(environment),
  };
}

function values(value?: string | string[]): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function applyProfileAndPlatform(source: MinkConfiguration, selected?: string): MinkConfiguration {
  const config = structuredClone(source);
  const profiles = selected
    ? selected
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
  for (const name of profiles) {
    const profile = config.profiles?.[name];
    if (!profile) throw new Error(`Unknown profile: ${name}`);
    config.vars = { ...config.vars, ...profile.vars };
    if (profile.env_file)
      config.env_file = [...values(config.env_file), ...values(profile.env_file)] as [
        string,
        ...string[],
      ];
    for (const [id, overlay] of Object.entries(profile.commands ?? {})) {
      if (!Object.hasOwn(config.commands, id))
        throw new Error(`Profile ${name}: unknown command ${id}`);
      const merged = { ...config.commands[id], ...overlay };
      if (overlay.exec !== undefined) delete merged.command;
      if (overlay.command !== undefined) delete merged.exec;
      config.commands[id] = merged as (typeof config.commands)[string];
    }
  }
  const platform: 'windows' | 'linux' | 'darwin' =
    process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  for (const [id, entry] of Object.entries(config.commands)) {
    if (entry.kind !== 'command') continue;
    const overlay = entry[platform];
    const vars = { ...config.vars, ...entry.vars, ...overlay?.vars };
    const merged = { ...entry, ...overlay };
    if (overlay?.exec !== undefined) delete merged.command;
    if (overlay?.command !== undefined) delete merged.exec;
    config.commands[id] = substitute(merged, vars) as typeof entry;
  }
  return substitute(config, config.vars ?? {}) as MinkConfiguration;
}

function substitute(value: unknown, vars: Record<string, string | number | boolean>): unknown {
  if (typeof value === 'string')
    return value.replace(/\$\{([^}]+)\}/g, (match, name: string) =>
      Object.hasOwn(vars, name) ? String(vars[name]) : match,
    );
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, substitute(item, vars)]),
  );
}

async function loadEnvironment(
  directory: string,
  configured?: string | string[],
): Promise<Record<string, string>> {
  const files = configured ? values(configured) : ['.env', '.env.local'];
  const environment: Record<string, string> = Object.create(null);
  for (const file of files) {
    let contents: string;
    try {
      contents = await readFile(resolve(directory, file), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      const raw = match[2];
      environment[match[1]] =
        (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
          ? raw.slice(1, -1)
          : raw.replace(/\s+#.*$/, '');
    }
  }
  return environment;
}
