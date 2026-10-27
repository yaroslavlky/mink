import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import type { ExecutionPlan } from './commands/plan.js';

const execute = promisify(execFile);
interface PackageManifest {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  mink?: { tags?: string[] };
}
export interface WorkspacePackage {
  name: string;
  directory: string;
  relativeDirectory: string;
  dependencies: string[];
  scripts: string[];
  tags: string[];
}

export async function workspaceGraph(directory: string): Promise<WorkspacePackage[]> {
  const root = await manifest(join(directory, 'package.json'));
  let patterns = Array.isArray(root.workspaces) ? root.workspaces : root.workspaces?.packages;
  if (!patterns) {
    try {
      const yaml = await readFile(join(directory, 'pnpm-workspace.yaml'), 'utf8');
      patterns = [...yaml.matchAll(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/gm)].map((match) => match[1]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const files = patterns?.length
    ? await glob(
        patterns.map((pattern) => `${pattern.replace(/\/$/, '')}/package.json`),
        {
          cwd: directory,
          absolute: true,
          onlyFiles: true,
          ignore: ['**/node_modules/**'],
        },
      )
    : [];
  const records = await Promise.all(
    files.map(async (file) => ({ file, value: await manifest(file) })),
  );
  const names = new Set(
    records.map(({ value, file }) => value.name ?? relative(directory, dirname(file))),
  );
  return records
    .map(({ file, value }) => {
      const packageDirectory = dirname(file);
      const name = value.name ?? relative(directory, packageDirectory);
      const dependencies = {
        ...value.dependencies,
        ...value.devDependencies,
        ...value.peerDependencies,
      };
      return {
        name,
        directory: packageDirectory,
        relativeDirectory: relative(directory, packageDirectory),
        dependencies: Object.keys(dependencies).filter((dependency) => names.has(dependency)),
        scripts: Object.keys(value.scripts ?? {}),
        tags: value.mink?.tags ?? [],
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function affectedPackages(directory: string, since = 'HEAD~1'): Promise<string[]> {
  const graph = await workspaceGraph(directory);
  const { stdout } = await execute('git', ['diff', '--name-only', `${since}...HEAD`], {
    cwd: directory,
    encoding: 'utf8',
  });
  const changed = new Set(
    graph
      .filter((item) =>
        stdout
          .split(/\r?\n/)
          .some(
            (file) =>
              file === item.relativeDirectory || file.startsWith(`${item.relativeDirectory}/`),
          ),
      )
      .map((item) => item.name),
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of graph)
      if (!changed.has(item.name) && item.dependencies.some((name) => changed.has(name))) {
        changed.add(item.name);
        expanded = true;
      }
  }
  return [...changed].sort();
}

export function analyzePlan(plan: ExecutionPlan): {
  nodes: number;
  criticalChain: string[];
  depth: number;
} {
  const memo = new Map<ExecutionPlan, string[]>();
  const visit = (node: ExecutionPlan): string[] => {
    const cached = memo.get(node);
    if (cached) return cached;
    const children = [...node.dependencies, ...Object.values(node.steps).map((step) => step.plan)];
    const longest = children.map(visit).sort((left, right) => right.length - left.length)[0] ?? [];
    const chain = [node.id, ...longest];
    memo.set(node, chain);
    return chain;
  };
  const criticalChain = visit(plan);
  return { nodes: memo.size, criticalChain, depth: criticalChain.length };
}

export async function pruneWorkspace(
  directory: string,
  target: string,
  output: string,
): Promise<string[]> {
  const graph = await workspaceGraph(directory);
  const selected = new Set<string>();
  const include = (name: string): void => {
    if (selected.has(name)) return;
    const item = graph.find((candidate) => candidate.name === name);
    if (!item) throw new Error(`Unknown workspace package: ${name}`);
    selected.add(name);
    item.dependencies.forEach(include);
  };
  include(target);
  const destination = resolve(directory, output);
  if (!relative(directory, destination) || relative(directory, destination).startsWith('..'))
    throw new Error('Prune output must be a child of the repository');
  await mkdir(destination, { recursive: true });
  for (const item of graph.filter((candidate) => selected.has(candidate.name)))
    await cp(item.directory, join(destination, item.relativeDirectory), {
      recursive: true,
      filter: (source) =>
        !source.split(/[\\/]/).some((part) => part === 'node_modules' || part === '.git'),
    });
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    await cp(join(directory, file), join(destination, file)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      },
    );
  await writeFile(
    join(destination, '.mink-prune.json'),
    JSON.stringify({ target, packages: [...selected] }, null, 2),
  );
  return [...selected];
}

async function manifest(file: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(file, 'utf8')) as PackageManifest;
}
