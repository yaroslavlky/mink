import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Command } from '../types/schema.js';
import { exists } from './discover.js';

export const projectFiles = [
  'package.json',
  'GNUmakefile',
  'makefile',
  'Makefile',
  'Taskfile.yml',
  'Taskfile.yaml',
  'compose.yml',
  'compose.yaml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'justfile',
  '.mise.toml',
  'Procfile',
  'process-compose.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'deno.json',
];
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (name: string) => /^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/.test(name);

/** Static discovery only: never run make, task, Docker or embedded shell expressions. */
export async function importTasks(directory: string): Promise<Record<string, Command>> {
  const entries: Record<string, Command> = Object.create(null);
  const first = async (files: string[]) => {
    for (const file of files) if (await exists(join(directory, file))) return file;
  };
  const make = await first(['GNUmakefile', 'makefile', 'Makefile']);
  if (make) {
    const text = await readFile(join(directory, make), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = /^([^\s#:=]+(?:[ \t]+[^\s#:=]+)*)[ \t]*:(?![=])/.exec(line);
      if (!match) continue;
      for (const name of match[1].split(/\s+/))
        if (identifier(name) && !name.startsWith('.'))
          entries[`make:${name}`] = {
            kind: 'command',
            name: `make ${name}`,
            description: `Target from ${make}`,
            exec: 'make',
            args: ['--file', make, '--', name],
          };
    }
  }
  const taskfile = await first(['Taskfile.yml', 'Taskfile.yaml']);
  if (taskfile) {
    const data: unknown = load(await readFile(join(directory, taskfile), 'utf8'));
    if (!record(data) || !record(data.tasks)) throw new Error(`Invalid tasks in ${taskfile}`);
    for (const [name, task] of Object.entries(data.tasks))
      if (identifier(name) && !(record(task) && task.internal))
        entries[`task:${name}`] = {
          kind: 'command',
          name: `task ${name}`,
          description:
            record(task) && typeof task.desc === 'string' ? task.desc : `Task from ${taskfile}`,
          exec: 'task',
          args: ['--taskfile', taskfile, name],
        };
  }
  const compose = await first([
    'compose.yml',
    'compose.yaml',
    'docker-compose.yml',
    'docker-compose.yaml',
  ]);
  if (compose) {
    const data: unknown = load(await readFile(join(directory, compose), 'utf8'));
    if (!record(data) || !record(data.services)) throw new Error(`Invalid services in ${compose}`);
    for (const action of ['up', 'down', 'build', 'logs', 'ps', 'config'])
      entries[`compose:${action}`] = {
        kind: 'command',
        name: `docker compose ${action}`,
        description: `${compose}${action === 'up' ? ' (detached containers are managed by Docker)' : ''}`,
        exec: 'docker',
        args: ['compose', '--file', compose, action, ...(action === 'up' ? ['--detach'] : [])],
      };
    for (const name of Object.keys(data.services))
      if (identifier(name))
        entries[`compose:up:${name}`] = {
          kind: 'command',
          name: `Start ${name}`,
          description: `Detached Docker service from ${compose}`,
          exec: 'docker',
          args: ['compose', '--file', compose, 'up', '--detach', name],
        };
  }
  const just = await first(['justfile', 'Justfile']);
  if (just)
    for (const line of (await readFile(join(directory, just), 'utf8')).split(/\r?\n/)) {
      const match = /^([A-Za-z_][\w-]*)[^:=]*:/.exec(line);
      if (match)
        entries[`just:${match[1]}`] = {
          kind: 'command',
          name: `just ${match[1]}`,
          exec: 'just',
          args: ['--justfile', just, match[1]],
        };
    }
  const procfile = await first(['Procfile']);
  if (procfile)
    for (const line of (await readFile(join(directory, procfile), 'utf8')).split(/\r?\n/)) {
      const match = /^([A-Za-z_][\w-]*):\s*(.+)$/.exec(line);
      if (match)
        entries[`procfile:${match[1]}`] = {
          kind: 'command',
          name: `Procfile ${match[1]}`,
          command: match[2],
          run: { mode: 'service' },
        };
    }
  const deno = await first(['deno.json', 'deno.jsonc']);
  if (deno) {
    const data = JSON.parse(
      (await readFile(join(directory, deno), 'utf8')).replace(/^\s*\/\/.*$/gm, ''),
    ) as { tasks?: Record<string, string> };
    for (const [name, task] of Object.entries(data.tasks ?? {}))
      entries[`deno:${name}`] = {
        kind: 'command',
        name: `deno task ${name}`,
        description: task,
        exec: 'deno',
        args: ['task', name],
      };
  }
  const processCompose = await first(['process-compose.yaml', 'process-compose.yml']);
  if (processCompose) {
    const data = load(await readFile(join(directory, processCompose), 'utf8')) as {
      processes?: Record<string, { command?: unknown }>;
    };
    for (const [name, process] of Object.entries(data.processes ?? {}))
      if (typeof process.command === 'string')
        entries[`process-compose:${name}`] = {
          kind: 'command',
          name,
          command: process.command,
          run: { mode: 'service' },
        };
  }
  const mise = await first(['.mise.toml', 'mise.toml']);
  if (mise) {
    const text = await readFile(join(directory, mise), 'utf8');
    for (const match of text.matchAll(/^\[tasks\.([A-Za-z_][\w-]*)\]/gm))
      entries[`mise:${match[1]}`] = {
        kind: 'command',
        name: `mise run ${match[1]}`,
        exec: 'mise',
        args: ['run', match[1]],
      };
  }
  const pyproject = await first(['pyproject.toml']);
  if (pyproject) {
    const text = await readFile(join(directory, pyproject), 'utf8');
    const section =
      /\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1] ?? '';
    for (const match of section.matchAll(/^([A-Za-z_][\w-]*)\s*=\s*['"]([^:'"]+)/gm))
      entries[`python:${match[1]}`] = {
        kind: 'command',
        name: match[1],
        exec: 'python',
        args: ['-m', match[2]],
      };
  }
  for (const [file, tool, actions] of [
    ['Cargo.toml', 'cargo', ['build', 'test', 'run']],
    ['go.mod', 'go', ['build', 'test', 'run']],
  ] as const)
    if (await exists(join(directory, file)))
      for (const action of actions)
        entries[`${tool}:${action}`] = {
          kind: 'command',
          name: `${tool} ${action}`,
          exec: tool,
          args: [action, ...(tool === 'go' && action === 'test' ? ['./...'] : [])],
        };
  return entries;
}
