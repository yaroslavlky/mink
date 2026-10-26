#!/usr/bin/env node
import { defineCommand, defineCittyPlugin, runMain, type ArgsDef } from 'citty';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import manifest from '../package.json' with { type: 'json' };
import { runMcpServer } from '@yaroslavlky/mink-mcp';
import {
  createMink,
  describePlan,
  doctor,
  formatPlan,
  graphDot,
  graphMermaid,
  graphText,
  formatConfig,
  lintConfig,
  shellCompletion,
  shellInit,
  upgradeMink,
  GlobalConfigStore,
  SupervisorServer,
  SupervisorClient,
  supervisorEndpoint,
  watchTasks,
  createRunLog,
  redactSecrets,
  initConfig,
  languages,
  parseParameter,
  themes,
  type Language,
  type ExecutionPlan,
  type Mink,
  type ParameterValue,
  type RunResult,
  type RunEvent,
  type Settings,
  type ThemeName,
  type ShellName,
  type GlobalConfig,
} from '@yaroslavlky/mink-core';
const strictArguments = defineCittyPlugin({
  name: 'strict-arguments',
  async setup({ cmd, rawArgs }) {
    const separator = rawArgs.indexOf('--');
    const checkedArgs = separator < 0 ? rawArgs : rawArgs.slice(0, separator);
    const definitions: ArgsDef =
      (await (typeof cmd.args === 'function' ? cmd.args() : cmd.args)) ?? {};
    const options = Object.fromEntries(
      Object.entries(definitions)
        .filter(([, def]) => def.type !== 'positional')
        .map(([name, def]) => [
          name,
          {
            type: def.type === 'boolean' ? ('boolean' as const) : ('string' as const),
            multiple: ['param', 'secret-env', 'path', 'ignore'].includes(name),
          },
        ]),
    );
    const parsed = parseArgs({
      args: checkedArgs,
      options,
      allowPositionals: true,
      allowNegative: true,
      strict: true,
    });
    const count = Object.values(definitions).filter((def) => def.type === 'positional').length;
    if (parsed.positionals.length > count && !Object.hasOwn(definitions, 'task'))
      throw new Error('Unexpected positional arguments');
  },
});
const common = {
  config: { type: 'string' as const, description: 'Path to mink.yml' },
  discovery: {
    type: 'boolean' as const,
    default: true,
    description: 'Import scripts (disable with --no-discovery)',
  },
  profile: {
    type: 'string' as const,
    description: 'Activate one or more comma-separated profiles',
  },
};
const task = {
  type: 'positional' as const,
  required: true as const,
  description: 'Command or pipeline ID',
};
const param = {
  type: 'string' as const,
  description: 'Repeat --param name=value for task parameters',
};
async function session<T>(
  args: { config?: string; discovery?: boolean; profile?: string },
  action: (m: Mink) => Promise<T>,
): Promise<T> {
  const mink = await createMink({
    configFile: args.config,
    discover: args.discovery,
    profile: args.profile,
  });
  try {
    return await action(mink);
  } finally {
    await mink.dispose();
  }
}
async function supervisor(mink: Mink, args: { profile?: string }): Promise<SupervisorClient> {
  const endpoint = supervisorEndpoint(mink.configFile);
  const client = new SupervisorClient(endpoint);
  try {
    await client.ping();
    return client;
  } catch {
    const child = spawn(
      process.execPath,
      [
        process.argv[1],
        'supervisor',
        'serve',
        '--config',
        mink.configFile,
        '--no-discovery',
        ...(args.profile ? ['--profile', args.profile] : []),
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(25);
      try {
        await client.ping();
        return client;
      } catch {
        /* Supervisor is still starting. */
      }
    }
    throw new Error('Supervisor did not start');
  }
}
function parameters(m: Mink, id: string, rawArgs: string[]): Record<string, ParameterValue> {
  const values: Record<string, ParameterValue> = Object.create(null),
    entry =
      m.getConfig().commands[id] ??
      Object.values(m.getConfig().commands).find((candidate) => candidate.aliases?.includes(id));
  if (!entry) throw new Error(`Unknown command: ${id}`);
  for (let i = 0; i < rawArgs.length; i++) {
    let raw: string | undefined;
    if (rawArgs[i] === '--param') raw = rawArgs[++i];
    else if (rawArgs[i].startsWith('--param=')) raw = rawArgs[i].slice(8);
    else continue;
    if (!raw || !raw.includes('=')) throw new Error('Use --param name=value');
    const at = raw.indexOf('='),
      name = raw.slice(0, at),
      p = entry.params?.[name];
    if (!p) throw new Error(`${id}: unknown parameter ${name}`);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate parameter: ${name}`);
    if (p.type === 'secret')
      throw new Error(`Use --secret-env ${name}=ENV_NAME to avoid a secret in shell history`);
    values[name] = parseParameter(p, raw.slice(at + 1));
  }
  for (let i = 0; i < rawArgs.length; i++) {
    let raw: string | undefined;
    if (rawArgs[i] === '--secret-env') raw = rawArgs[++i];
    else if (rawArgs[i].startsWith('--secret-env=')) raw = rawArgs[i].slice(13);
    else continue;
    if (!raw?.includes('=')) throw new Error('Use --secret-env name=ENV_NAME');
    const at = raw.indexOf('='),
      name = raw.slice(0, at),
      env = raw.slice(at + 1),
      p = entry.params?.[name];
    if (p?.type !== 'secret' || Object.hasOwn(values, name))
      throw new Error(`Invalid or duplicate secret parameter: ${name}`);
    if (process.env[env] === undefined) throw new Error(`Environment variable ${env} is not set`);
    values[name] = process.env[env]!;
  }
  const separator = rawArgs.indexOf('--');
  const parsed = parseArgs({
    args: separator < 0 ? rawArgs : rawArgs.slice(0, separator),
    strict: false,
    allowPositionals: true,
    options: {
      param: { type: 'string', multiple: true },
      'secret-env': { type: 'string', multiple: true },
    },
  });
  const positional = Object.entries(entry.params ?? {}).filter(
    ([, definition]) => definition.positional,
  );
  const supplied = parsed.positionals.slice(1);
  for (const [index, [name, definition]] of positional.entries()) {
    if (Object.hasOwn(values, name)) continue;
    const raw = definition.variadic ? supplied.slice(index).join(',') : supplied[index];
    if (raw !== undefined) values[name] = parseParameter(definition, raw);
  }
  return values;
}
export function exitCode(result: RunResult): number {
  return result.timedOut
    ? 124
    : result.state === 'cancelled'
      ? result.signal === 'SIGTERM'
        ? 143
        : 130
      : (result.exitCode ?? 1);
}
async function confirmPlan(plan: ExecutionPlan, approved?: boolean): Promise<void> {
  const messages: string[] = [];
  const visit = (node: ExecutionPlan) => {
    if (node.entry?.confirm || node.entry?.prompt)
      messages.push(
        node.entry.prompt ??
          (typeof node.entry.confirm === 'string'
            ? node.entry.confirm
            : `Run dangerous command ${node.id}?`),
      );
    node.dependencies.forEach(visit);
    Object.values(node.steps).forEach((step) => visit(step.plan));
  };
  visit(plan);
  if (!messages.length || approved) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Confirmation required; rerun with --yes in non-interactive mode');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const message of [...new Set(messages)]) {
      const answer = await prompt.question(`${message} [y/N] `);
      if (!/^y(?:es)?$/i.test(answer.trim())) throw new Error('Command cancelled');
    }
  } finally {
    prompt.close();
  }
}
const commands = {
  watch: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Rerun a task when project files change' },
    args: {
      ...common,
      task,
      param,
      preset: { type: 'string', description: 'Saved preset name' },
      'secret-env': {
        type: 'string',
        description: 'Read secret parameter from an environment variable',
      },
      path: {
        type: 'string',
        description: 'Watch a file or directory (repeatable; defaults to project root)',
      },
      ignore: { type: 'string', description: 'Ignore a file or directory (repeatable)' },
      debounce: { type: 'string', default: '150', description: 'Debounce in milliseconds' },
      mode: {
        type: 'string',
        default: 'restart',
        description: 'restart cancels the previous run; queue waits for it',
      },
      json: { type: 'boolean', description: 'JSON Lines output' },
    },
    async run({ args, rawArgs }) {
      if (!['restart', 'queue'].includes(args.mode))
        throw new Error('Watch mode must be restart or queue');
      const repeated = (name: string) =>
        parseArgs({
          args: rawArgs,
          strict: false,
          allowPositionals: true,
          options: { [name]: { type: 'string', multiple: true } },
        }).values[name] as string[] | undefined;
      const initial = await createMink({
        configFile: args.config,
        discover: args.discovery,
        profile: args.profile,
      });
      let values: Record<string, ParameterValue>;
      try {
        values = {
          ...(args.preset ? await initial.preset(args.task, args.preset) : {}),
          ...parameters(initial, args.task, rawArgs),
        };
        initial.plan(args.task, values);
      } finally {
        await initial.dispose();
      }
      const controller = new AbortController();
      const interrupt = () => {
        process.exitCode = 130;
        controller.abort();
      };
      const terminate = () => {
        process.exitCode = 143;
        controller.abort();
      };
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', terminate);
      try {
        await watchTasks({
          directory: initial.directory,
          paths: repeated('path'),
          ignore: repeated('ignore'),
          debounceMs: Number(args.debounce),
          mode: args.mode as 'restart' | 'queue',
          signal: controller.signal,
          onReady: () =>
            process.stderr.write(`Watching ${initial.directory}; Ctrl+C stops this session.\n`),
          onError: (error) => process.stderr.write(`${String(error)}\n`),
          run: async (signal) => {
            await session(args, async (m) => {
              const result = await m.run(args.task, values, {
                signal,
                onEvent: (event) => {
                  if (args.json) process.stdout.write(`${JSON.stringify(event)}\n`);
                  else if (event.chunk)
                    (event.type === 'stderr' ? process.stderr : process.stdout).write(event.chunk);
                },
              });
              if (args.json)
                process.stdout.write(
                  `${JSON.stringify({ type: 'summary', formatVersion: 1, id: args.task, result })}\n`,
                );
              else
                process.stderr.write(`${args.task}: ${result.state} (${result.durationMs} ms)\n`);
              const services = m.services();
              if (services.length && (result.state === 'succeeded' || result.state === 'ready'))
                await Promise.all(services.map((service) => service.completion));
            });
          },
        });
      } finally {
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
      }
    },
  }),
  doctor: defineCommand({
    plugins: [strictArguments],
    meta: {
      description: 'Diagnose configuration, tools, local ports and storage without running tasks',
    },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      const report = await doctor({ configFile: args.config, discover: args.discovery });
      console.log(
        args.json
          ? JSON.stringify(report, null, 2)
          : report.checks
              .map(
                (check) =>
                  `${check.status.toUpperCase()} ${check.message}${check.status !== 'pass' && check.hint ? `\n  ${check.hint}` : ''}`,
              )
              .join('\n'),
      );
      process.exitCode = report.ok ? 0 : 1;
    },
  }),
  plan: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Inspect the resolved execution graph without running commands' },
    args: {
      ...common,
      task,
      param,
      preset: { type: 'string', description: 'Saved preset name' },
      'secret-env': {
        type: 'string',
        description: 'Read secret parameter from an environment variable',
      },
      json: { type: 'boolean', description: 'JSON output (secrets are masked)' },
    },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        const values = {
          ...(args.preset ? await m.preset(args.task, args.preset) : {}),
          ...parameters(m, args.task, rawArgs),
        };
        const plan = describePlan(m.plan(args.task, values));
        console.log(
          args.json ? JSON.stringify({ formatVersion: 1, plan }, null, 2) : formatPlan(plan),
        );
      });
    },
  }),
  run: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Run a command or pipeline' },
    args: {
      ...common,
      task,
      param,
      preset: { type: 'string', description: 'Saved preset name' },
      'dry-run': { type: 'boolean', description: 'Print the execution plan without running tasks' },
      force: { type: 'boolean', description: 'Ignore local cache entries for this run' },
      yes: { type: 'boolean', description: 'Approve dangerous commands non-interactively' },
      output: {
        type: 'string',
        default: 'interleave',
        description: 'prefix, interleave, grouped, quiet, or timed',
      },
      tag: { type: 'string', description: 'Select commands by tag' },
      group: { type: 'string', description: 'Select commands by group' },
      D: { type: 'boolean', description: 'Run through the background supervisor' },
      'log-file': { type: 'string', description: 'Write redacted JSONL output to a new file' },
      'explain-failure': {
        type: 'boolean',
        description: 'Print a structured failure suitable for an agent',
      },
      json: { type: 'boolean', description: 'JSON output with --dry-run' },
      'secret-env': {
        type: 'string',
        description: 'Read secret parameter from an environment variable',
      },
    },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        if (!['prefix', 'interleave', 'grouped', 'quiet', 'timed'].includes(args.output))
          throw new Error('Output must be prefix, interleave, grouped, quiet, or timed');
        const targets = m.select(args.task, args.tag, args.group);
        if ((args.tag || args.group || args.task.includes('*')) && !targets.length)
          throw new Error('Selector matched no commands');
        if (targets.length > 1) {
          if (rawArgs.some((value) => value === '--param' || value.startsWith('--param=')))
            throw new Error('Parameters cannot be shared across a multi-command selector');
          let failed = false;
          for (const id of targets) {
            const plan = m.plan(id);
            await confirmPlan(plan, args.yes);
            const result = await m.run(
              id,
              {},
              {
                force: args.force,
                approved: true,
                stdin: 'inherit',
                onEvent: (event) => {
                  if (event.chunk && args.output !== 'quiet')
                    process.stdout.write(`[${event.id}] ${event.chunk}`);
                },
              },
            );
            failed ||= result.state === 'failed';
          }
          process.exitCode = failed ? 1 : 0;
          return;
        }
        const selectedTask = targets[0] ?? args.task;
        const values = {
            ...(args.preset ? await m.preset(selectedTask, args.preset) : {}),
            ...parameters(m, selectedTask, rawArgs),
          },
          controller = new AbortController();
        if (args.D) {
          await confirmPlan(m.plan(selectedTask, values), args.yes);
          const result = await (await supervisor(m, args)).run(selectedTask, values);
          console.log(
            args.json
              ? JSON.stringify({ formatVersion: 1, id: selectedTask, result }, null, 2)
              : `${selectedTask}: ${result.state} (${result.durationMs} ms)`,
          );
          process.exitCode = exitCode(result);
          return;
        }
        const passthroughAt = rawArgs.indexOf('--');
        const passthrough = passthroughAt < 0 ? [] : rawArgs.slice(passthroughAt + 1);
        if (args['dry-run']) {
          const plan = describePlan(m.plan(selectedTask, values));
          console.log(
            args.json ? JSON.stringify({ formatVersion: 1, plan }, null, 2) : formatPlan(plan),
          );
          return;
        }
        const executionPlan = m.plan(selectedTask, values);
        await confirmPlan(executionPlan, args.yes);
        const failureEvents: RunEvent[] = [];
        const log = args['log-file'] ? createRunLog(args['log-file'], executionPlan) : undefined;
        let interrupted: NodeJS.Signals | undefined;
        const sigint = () => {
            interrupted = 'SIGINT';
            controller.abort();
          },
          sigterm = () => {
            interrupted = 'SIGTERM';
            controller.abort();
          };
        process.on('SIGINT', sigint);
        process.on('SIGTERM', sigterm);
        try {
          const grouped: string[] = [];
          const r = await m.run(selectedTask, values, {
            signal: controller.signal,
            stdin: 'inherit',
            force: args.force,
            args: passthrough,
            approved: true,
            onEvent: (e) => {
              if (e.type === 'stderr' || e.type === 'finish') {
                failureEvents.push(e);
                if (failureEvents.length > 50) failureEvents.shift();
              }
              log?.write(e);
              if (!e.chunk || args.output === 'quiet' || args.json) return;
              const chunk =
                args.output === 'prefix'
                  ? e.chunk
                      .split(/(?<=\n)/)
                      .map((line) => (line ? `[${e.id}] ${line}` : line))
                      .join('')
                  : args.output === 'timed'
                    ? `[${new Date(e.time).toISOString()}] [${e.id}] ${e.chunk}`
                    : e.chunk;
              if (args.output === 'grouped') grouped.push(chunk);
              else (e.type === 'stderr' ? process.stderr : process.stdout).write(chunk);
            },
          });
          if (grouped.length) process.stdout.write(grouped.join(''));
          const services = m.services();
          let serviceFailed = false;
          if (services.length && (r.state === 'ready' || r.state === 'succeeded')) {
            if (services.some((s) => s.state === 'ready' || s.state === 'starting'))
              process.stderr.write('Services ready; Ctrl+C stops this session.\n');
            const lifetime = await Promise.all(services.map((s) => s.completion));
            serviceFailed = lifetime.some((result) => result.state === 'failed');
          }
          process.exitCode =
            interrupted === 'SIGTERM' ? 143 : interrupted ? 130 : serviceFailed ? 1 : exitCode(r);
          if (args['explain-failure'] && r.state === 'failed')
            console.log(
              JSON.stringify({
                formatVersion: 1,
                failure: {
                  step: selectedTask,
                  exitCode: r.exitCode,
                  signal: r.signal,
                  timedOut: r.timedOut,
                  error: r.error,
                  tail: failureEvents.map((event) => ({
                    type: event.type,
                    id: event.id,
                    chunk: event.chunk
                      ? redactSecrets(event.chunk, executionPlan).slice(-4000)
                      : undefined,
                  })),
                },
              }),
            );
          if (args.json)
            console.log(
              JSON.stringify(
                { formatVersion: 1, id: selectedTask, result: r, serviceFailed },
                null,
                2,
              ),
            );
          else
            process.stderr.write(
              `${selectedTask}: ${interrupted ? 'cancelled' : serviceFailed ? 'failed' : r.state} (${r.durationMs} ms)${r.error ? `: ${r.error}` : ''}\n`,
            );
        } finally {
          process.off('SIGINT', sigint);
          process.off('SIGTERM', sigterm);
          log?.close();
        }
      });
    },
  }),
  list: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'List discovered and configured commands' },
    args: {
      ...common,
      json: { type: 'boolean', description: 'JSON output' },
      tag: { type: 'string', description: 'Filter by tag' },
      group: { type: 'string', description: 'Filter by group' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const selected = new Set(m.select('*', args.tag, args.group));
        const entries = m.searchCommands('').filter(({ id }) => selected.has(id));
        console.log(
          args.json
            ? JSON.stringify(
                entries.map(({ id, entry }) => ({ id, ...entry })),
                null,
                2,
              )
            : entries
                .map(
                  ({ id, entry }) =>
                    `${id}\t${entry.name}\t${entry.kind === 'pipeline' ? 'pipeline' : (entry.run?.mode ?? 'task')}`,
                )
                .join('\n'),
        );
      });
    },
  }),
  env: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Show the resolved command environment with secrets masked' },
    args: {
      ...common,
      task,
      param,
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        const environment = m.environment(args.task, parameters(m, args.task, rawArgs));
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, environment }, null, 2)
            : Object.entries(environment)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, value]) => `${name}=${value}`)
                .join('\n'),
        );
      });
    },
  }),
  graph: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Print the command dependency graph' },
    args: {
      ...common,
      json: { type: 'boolean', description: 'JSON output' },
      dot: { type: 'boolean', description: 'Graphviz DOT output' },
      mermaid: { type: 'boolean', description: 'Mermaid output' },
    },
    async run({ args }) {
      const formats = [args.json, args.dot, args.mermaid].filter(Boolean).length;
      if (formats > 1) throw new Error('Choose only one of --json, --dot, or --mermaid');
      await session(args, async (m) => {
        const graph = m.graph();
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, ...graph }, null, 2)
            : args.dot
              ? graphDot(graph)
              : args.mermaid
                ? graphMermaid(graph)
                : graphText(graph),
        );
      });
    },
  }),
  explain: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Explain the resolved command and cache decision' },
    args: { ...common, task, param, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        const values = parameters(m, args.task, rawArgs);
        const plan = describePlan(m.plan(args.task, values));
        const cache = await m.why(args.task, values);
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, plan, cache }, null, 2)
            : `${formatPlan(plan)}\n\nCache:\n${cache.map((item) => `- ${item.reason}`).join('\n')}`,
        );
      });
    },
  }),
  summary: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Print a compact command summary' },
    args: { ...common, task, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        const entry = m.getConfig().commands[args.task];
        if (!entry) throw new Error(`Unknown command: ${args.task}`);
        const summary = {
          id: args.task,
          name: entry.name,
          kind: entry.kind,
          description: entry.description ?? '',
          tags: entry.tags ?? [],
          group: entry.group ?? null,
        };
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, ...summary }, null, 2)
            : `${summary.id}\t${summary.kind}\t${summary.name}${summary.description ? `\n${summary.description}` : ''}`,
        );
      });
    },
  }),
  choose: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Choose a command with fuzzy search without opening the TUI' },
    args: {
      ...common,
      query: { type: 'positional', required: false, description: 'Initial search text' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        let query = args.query ?? '';
        if (!query && process.stdin.isTTY && process.stdout.isTTY) {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            query = await prompt.question('Search command: ');
          } finally {
            prompt.close();
          }
        }
        const selected = m.searchCommands(query, 1)[0];
        if (!selected) throw new Error('No command matched');
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, id: selected.id, entry: selected.entry }, null, 2)
            : selected.id,
        );
      });
    },
  }),
  completions: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Generate shell completions' },
    args: {
      shell: { type: 'positional', required: true, description: 'bash, zsh, fish, or powershell' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    run({ args }) {
      if (!['bash', 'zsh', 'fish', 'powershell'].includes(args.shell))
        throw new Error('Unsupported shell');
      const script = shellCompletion(args.shell as ShellName);
      console.log(
        args.json ? JSON.stringify({ formatVersion: 1, shell: args.shell, script }) : script,
      );
    },
  }),
  'shell-init': defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Generate shell initialization and completions' },
    args: {
      shell: { type: 'positional', required: true, description: 'bash, zsh, fish, or powershell' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    run({ args }) {
      if (!['bash', 'zsh', 'fish', 'powershell'].includes(args.shell))
        throw new Error('Unsupported shell');
      const script = shellInit(args.shell as ShellName);
      console.log(
        args.json ? JSON.stringify({ formatVersion: 1, shell: args.shell, script }) : script,
      );
    },
  }),
  upgrade: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Upgrade Mink through npm' },
    args: {
      yes: { type: 'boolean', description: 'Confirm the global npm update' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      if (!args.yes) throw new Error('Upgrade changes the global installation; rerun with --yes');
      await upgradeMink((chunk, stderr) => {
        if (!args.json) (stderr ? process.stderr : process.stdout).write(chunk);
      });
      if (args.json) console.log(JSON.stringify({ formatVersion: 1, upgraded: true }));
    },
  }),
  config: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Read or update global Mink configuration' },
    args: {
      action: { type: 'positional', required: true, description: 'get or set' },
      key: { type: 'positional', required: false, description: 'Configuration key' },
      value: { type: 'positional', required: false, description: 'New value' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      const store = new GlobalConfigStore();
      const keys: Array<keyof GlobalConfig> = [
        'defaultProfile',
        'output',
        'cacheTtlMs',
        'cacheMaxSizeBytes',
      ];
      if (!['get', 'set'].includes(args.action))
        throw new Error('Config action must be get or set');
      if (args.action === 'get') {
        const value = args.key
          ? keys.includes(args.key as keyof GlobalConfig)
            ? await store.get(args.key as keyof GlobalConfig)
            : (() => {
                throw new Error(`Unknown config key: ${args.key}`);
              })()
          : await store.read();
        console.log(
          args.json ? JSON.stringify({ formatVersion: 1, value }, null, 2) : JSON.stringify(value),
        );
        return;
      }
      if (!args.key || args.value === undefined || !keys.includes(args.key as keyof GlobalConfig))
        throw new Error('Use mink config set <key> <value>');
      const value = args.key.startsWith('cache') ? Number(args.value) : args.value;
      if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
        throw new Error('Cache limits must be non-negative numbers');
      if (
        args.key === 'output' &&
        !['prefix', 'interleave', 'grouped', 'quiet', 'timed'].includes(String(value))
      )
        throw new Error('Invalid output mode');
      await store.set(args.key as keyof GlobalConfig, value as GlobalConfig[keyof GlobalConfig]);
      console.log(
        args.json ? JSON.stringify({ formatVersion: 1, key: args.key, value }) : `Set ${args.key}`,
      );
    },
  }),
  supervisor: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Run the background supervisor server' },
    args: {
      ...common,
      action: { type: 'positional', required: true, description: 'serve' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      if (args.action !== 'serve') throw new Error('Supervisor action must be serve');
      const mink = await createMink({
        configFile: args.config,
        discover: args.discovery,
        profile: args.profile,
      });
      const server = new SupervisorServer(mink, supervisorEndpoint(mink.configFile));
      await server.listen();
      if (args.json)
        console.log(
          JSON.stringify({ formatVersion: 1, pid: process.pid, endpoint: server.endpoint }),
        );
      let close!: () => void;
      const done = new Promise<void>((resolve) => {
        close = resolve;
      });
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
      await done;
      await server.close();
    },
  }),
  attach: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Attach to the project supervisor' },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        const status = await (await supervisor(m, args)).request({ action: 'status' });
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, status }, null, 2)
            : JSON.stringify(status, null, 2),
        );
      });
    },
  }),
  detach: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Detach while leaving supervisor services running' },
    args: { json: { type: 'boolean', description: 'JSON output' } },
    run({ args }) {
      console.log(args.json ? JSON.stringify({ formatVersion: 1, detached: true }) : 'Detached');
    },
  }),
  stop: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Stop supervisor-owned services' },
    args: {
      ...common,
      instance: { type: 'positional', required: false, description: 'Service instance' },
      all: { type: 'boolean', description: 'Stop all services' },
      force: { type: 'boolean', description: 'Force termination' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      if (!args.all && !args.instance) throw new Error('Use an instance or --all');
      await session(args, async (m) => {
        const value = await (
          await supervisor(m, args)
        ).request({
          action: 'stop',
          instance: args.instance,
          all: args.all,
          force: args.force,
        });
        console.log(
          args.json ? JSON.stringify({ formatVersion: 1, value }, null, 2) : JSON.stringify(value),
        );
      });
    },
  }),
  scale: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Scale a supervisor-owned service' },
    args: {
      ...common,
      service: { type: 'positional', required: true, description: 'Service ID' },
      count: { type: 'positional', required: true, description: 'Replica count' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const services = await (
          await supervisor(m, args)
        ).request({
          action: 'scale',
          service: args.service,
          count: Number(args.count),
        });
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, services }, null, 2)
            : JSON.stringify(services),
        );
      });
    },
  }),
  disable: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Disable or enable a supervisor service' },
    args: {
      ...common,
      service: { type: 'positional', required: true, description: 'Service ID' },
      enable: { type: 'boolean', description: 'Enable instead of disable' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const value = await (
          await supervisor(m, args)
        ).request({
          action: 'disable',
          service: args.service,
          disabled: !args.enable,
        });
        console.log(
          args.json ? JSON.stringify({ formatVersion: 1, value }, null, 2) : JSON.stringify(value),
        );
      });
    },
  }),
  logs: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Read supervisor logs' },
    args: {
      ...common,
      service: { type: 'positional', required: false, description: 'Service ID' },
      lines: { type: 'string', default: '200', description: 'Maximum lines' },
      follow: { type: 'boolean', description: 'Follow logs' },
      since: {
        type: 'string',
        description: 'Only events since an ISO timestamp or milliseconds ago',
      },
      json: { type: 'boolean', description: 'JSON Lines output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const client = await supervisor(m, args);
        let seen = 0;
        for (;;) {
          const events = await client.request<RunEvent[]>({
            action: 'logs',
            owner: args.service,
            limit: Number(args.lines),
          });
          const since = args.since
            ? /^\d+$/.test(args.since)
              ? Date.now() - Number(args.since)
              : Date.parse(args.since)
            : 0;
          for (const event of events.slice(seen).filter((event) => event.time >= since))
            process.stdout.write(
              args.json
                ? `${JSON.stringify(event)}\n`
                : `${new Date(event.time).toISOString()} [${event.id}] ${event.chunk ?? ''}`,
            );
          seen = events.length;
          if (!args.follow) break;
          await delay(250);
        }
      });
    },
  }),
  events: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Print the supervisor event stream as JSONL' },
    args: {
      ...common,
      lines: { type: 'string', default: '200', description: 'Maximum events' },
      json: { type: 'boolean', default: true, description: 'JSON Lines output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const events = await (
          await supervisor(m, args)
        ).request<RunEvent[]>({
          action: 'events',
          limit: Number(args.lines),
        });
        for (const event of events) console.log(JSON.stringify(event));
      });
    },
  }),
  runs: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'List, show, or replay numbered supervisor runs' },
    args: {
      ...common,
      action: { type: 'positional', required: true, description: 'ls, show, or replay' },
      number: { type: 'positional', required: false, description: 'Run number' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        if (!['ls', 'show', 'replay'].includes(args.action))
          throw new Error('Runs action must be ls, show, or replay');
        const client = await supervisor(m, args);
        const history = await client.request<
          Array<{ id: string; time: string; state: string; durationMs: number }>
        >({ action: 'history' });
        if (args.action === 'ls') {
          const entries = history.map((entry, index) => ({ number: index + 1, ...entry }));
          console.log(
            args.json
              ? JSON.stringify({ formatVersion: 1, runs: entries }, null, 2)
              : entries
                  .map((entry) => `${entry.number}\t${entry.id}\t${entry.state}\t${entry.time}`)
                  .join('\n'),
          );
          return;
        }
        const entry = history[Number(args.number) - 1];
        if (!entry) throw new Error('Unknown run number');
        const value = args.action === 'replay' ? await client.run(entry.id) : entry;
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, value }, null, 2)
            : JSON.stringify(value, null, 2),
        );
      });
    },
  }),
  fmt: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Format mink.yml canonically' },
    args: { config: common.config, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      const file = await formatConfig(args.config);
      console.log(args.json ? JSON.stringify({ formatVersion: 1, file }) : `Formatted ${file}`);
    },
  }),
  lint: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Find unused private commands and invalid references' },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        const issues = lintConfig(m.getConfig());
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, issues }, null, 2)
            : issues.map((issue) => `${issue.level}: ${issue.message}`).join('\n') || 'No issues',
        );
        process.exitCode = issues.length ? 1 : 0;
      });
    },
  }),
  why: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Explain cache eligibility and whether a command would run' },
    args: { ...common, task, param, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        const statuses = await m.why(args.task, parameters(m, args.task, rawArgs));
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, entries: statuses }, null, 2)
            : statuses
                .map((status) =>
                  status.enabled
                    ? `${status.entry ? 'skipped (cache hit)' : 'will run'}: ${status.reason}`
                    : `will run: ${status.reason}`,
                )
                .join('\n'),
        );
      });
    },
  }),
  cache: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Inspect and maintain the local execution cache' },
    args: {
      ...common,
      action: { type: 'positional', required: true, description: 'ls, clear, or prune' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        if (!['ls', 'clear', 'prune'].includes(args.action))
          throw new Error('Cache action must be ls, clear, or prune');
        if (args.action === 'clear') {
          await m.clearCache();
          console.log(
            args.json ? JSON.stringify({ formatVersion: 1, cleared: true }) : 'Cache cleared',
          );
          return;
        }
        const info = args.action === 'prune' ? await m.pruneCache() : await m.cacheInfo();
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, ...info }, null, 2)
            : `${info.entries} entries, ${info.size} bytes`,
        );
      });
    },
  }),
  trust: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Trust the current configuration hash before executing foreign configs' },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        const status = await m.trust();
        console.log(
          args.json ? JSON.stringify({ formatVersion: 1, ...status }) : 'Configuration trusted',
        );
      });
    },
  }),
  untrust: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Remove trust for the current configuration' },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        await m.untrust();
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, trusted: false })
            : 'Configuration untrusted',
        );
      });
    },
  }),
  check: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Validate configuration and references without execution' },
    args: { ...common, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        const count = Object.keys(m.getConfig().commands).length;
        console.log(
          args.json
            ? JSON.stringify({
                formatVersion: 1,
                valid: true,
                commands: count,
                directory: m.directory,
              })
            : `Valid: ${count} commands (${m.directory})`,
        );
      });
    },
  }),
  init: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Create mink.yml without overwriting an existing file' },
    args: {
      config: common.config,
      agent: { type: 'boolean', description: 'Also create an AGENTS.md guide' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      const file = await initConfig(args.config);
      const agentFile = resolve(file, '..', 'AGENTS.md');
      if (args.agent)
        await writeFile(
          agentFile,
          '# Repository commands\n\nUse `mink list --json` to discover commands, `mink plan <id> --json` before execution, and `mink run <id> --explain-failure` for bounded diagnostics. Never print secret parameter values.\n',
          { flag: 'wx' },
        );
      const result = { formatVersion: 1, file, ...(args.agent ? { agentFile } : {}) };
      console.log(
        args.json
          ? JSON.stringify(result)
          : `Created ${file}${args.agent ? ` and ${agentFile}` : ''}`,
      );
    },
  }),
  mcp: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Run the permission-aware MCP server over stdio' },
    args: {
      ...common,
      'read-only': { type: 'boolean', description: 'Disable mutating tools' },
      allow: { type: 'string', description: 'Comma-separated command IDs or tags' },
      approve: { type: 'boolean', description: 'Require approval on every mutation' },
      'max-runs': { type: 'string', default: '20', description: 'Maximum runs per session' },
      'timeout-ms': { type: 'string', description: 'Maximum duration of each run' },
      'log-limit': { type: 'string', default: '200', description: 'Maximum retained log lines' },
    },
    async run({ args }) {
      await runMcpServer({
        cwd: typeof args.cwd === 'string' ? args.cwd : undefined,
        configFile: typeof args.config === 'string' ? args.config : undefined,
        readOnly: args['read-only'],
        allow: args.allow?.split(',').filter(Boolean),
        approve: args.approve,
        maxRuns: Number(args['max-runs']),
        timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
        logLimit: Number(args['log-limit']),
      });
    },
  }),
  report: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Write a redacted diagnostic bundle for a run' },
    args: {
      ...common,
      run: { type: 'positional', required: true, description: 'Run number or command ID' },
      output: { type: 'string', default: 'mink-report.json', description: 'Output path' },
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args }) {
      await session(args, async (m) => {
        const history = (await m.state()).history;
        const index = Number(args.run);
        const selected =
          Number.isInteger(index) && index > 0
            ? history[index - 1]
            : history.find((entry) => entry.id === args.run);
        if (!selected) throw new Error(`Unknown run: ${args.run}`);
        const bundle = {
          formatVersion: 1,
          run: selected,
          graph: m.graph(),
          environment: m.environment(selected.id),
          plan: describePlan(m.plan(selected.id)),
        };
        const file = resolve(args.output);
        await writeFile(file, `${JSON.stringify(bundle, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
        console.log(args.json ? JSON.stringify({ formatVersion: 1, file }) : `Created ${file}`);
      });
    },
  }),
  schema: defineCommand({
    meta: { description: 'Print JSON Schemas for machine-readable output' },
    subCommands: {
      output: defineCommand({
        args: {
          command: { type: 'positional', required: true, description: 'CLI command' },
        },
        run({ args }) {
          const properties: Record<string, unknown> = { formatVersion: { const: 1 } };
          if (args.command === 'list') properties.commands = { type: 'array' };
          else if (args.command === 'run') properties.result = { type: 'object' };
          else if (args.command === 'plan') properties.plan = { type: 'object' };
          else if (args.command === 'check') properties.valid = { type: 'boolean' };
          else properties.data = {};
          console.log(
            JSON.stringify(
              {
                $schema: 'https://json-schema.org/draft/2020-12/schema',
                type: 'object',
                required: ['formatVersion'],
                properties,
                additionalProperties: true,
              },
              null,
              2,
            ),
          );
        },
      }),
    },
  }),
  preset: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Save a local preset (secret values are forbidden)' },
    args: {
      ...common,
      task,
      name: { type: 'positional', required: true, description: 'New preset name' },
      param,
      json: { type: 'boolean', description: 'JSON output' },
    },
    async run({ args, rawArgs }) {
      await session(args, async (m) => {
        await m.savePreset(args.task, args.name, parameters(m, args.task, rawArgs));
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, id: args.task, preset: args.name })
            : `Saved ${args.task}@${args.name}`,
        );
      });
    },
  }),
  favorite: defineCommand({
    plugins: [strictArguments],
    meta: { description: 'Toggle a command in local favorites' },
    args: { ...common, task, json: { type: 'boolean', description: 'JSON output' } },
    async run({ args }) {
      await session(args, async (m) => {
        await m.favorite(args.task);
        console.log(
          args.json
            ? JSON.stringify({ formatVersion: 1, id: args.task, toggled: true })
            : `Favorite toggled: ${args.task}`,
        );
      });
    },
  }),
};
const ui = defineCommand({
  plugins: [strictArguments],
  meta: { description: 'Open the interactive command palette' },
  args: {
    ...common,
    theme: { type: 'string', description: `Theme for this session only: ${themes.join(', ')}` },
    lang: {
      type: 'string',
      description: `Language for this session only: ${languages.join(', ')}`,
    },
  },
  async run({ args }) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error('The palette needs a TTY. Use mink list, mink run <task>, or mink --help.');
    const overrides: Partial<Settings> = {};
    if (args.theme !== undefined) {
      if (!(themes as readonly string[]).includes(args.theme))
        throw new Error(`Unknown theme: ${args.theme}. Use one of: ${themes.join(', ')}`);
      overrides.theme = args.theme as ThemeName;
    }
    if (args.lang !== undefined) {
      if (!(languages as readonly string[]).includes(args.lang))
        throw new Error(`Unknown language: ${args.lang}. Use one of: ${languages.join(', ')}`);
      overrides.language = args.lang as Language;
    }
    await session(args, async (m) => {
      const { openTui } = await import('@yaroslavlky/mink-tui');
      await openTui(m, overrides);
    });
  },
});
const main = defineCommand({
  meta: { name: 'mink', version: manifest.version, description: 'Your repository control center' },
  args: common,
  subCommands: { ...commands, ui },
  default: 'ui',
});
await runMain(main);
