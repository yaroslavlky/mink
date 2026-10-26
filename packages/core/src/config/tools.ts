import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dump, load } from 'js-yaml';
import type { MinkConfiguration } from '../types/schema.js';
import { validateConfig } from './load.js';

export async function formatConfig(file = 'mink.yml', cwd = process.cwd()): Promise<string> {
  const path = resolve(cwd, file);
  const parsed: unknown = load(await readFile(path, 'utf8'));
  validateConfig(parsed);
  await writeFile(path, dump(parsed, { noRefs: true, lineWidth: 100, sortKeys: false }), 'utf8');
  return path;
}

export interface LintIssue {
  level: 'warning';
  code: 'unused-private';
  command: string;
  message: string;
}

export function lintConfig(config: MinkConfiguration): LintIssue[] {
  const referenced = new Set<string>();
  for (const entry of Object.values(config.commands)) {
    if (entry.kind === 'command') entry.depends_on?.forEach((id) => referenced.add(id));
    else Object.values(entry.steps).forEach((step) => referenced.add(step.uses));
  }
  return Object.entries(config.commands)
    .filter(([id, entry]) => (entry.private || entry.internal) && !referenced.has(id))
    .map(([id]) => ({
      level: 'warning' as const,
      code: 'unused-private' as const,
      command: id,
      message: `${id} is private but never referenced`,
    }));
}
