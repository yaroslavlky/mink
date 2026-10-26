import type { Command, MinkConfiguration } from '../types/schema.js';
import type { RunResult } from '../runtime/process.js';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import {
  prepareEntry,
  resolveValues,
  type ParameterValue,
  type PreparedCommand,
} from './resolve.js';
export interface ExecutionPlan {
  id: string;
  key: string;
  entry?: Command;
  prepared?: PreparedCommand;
  dependencies: ExecutionPlan[];
  dependencyRules: Array<{
    condition: 'started' | 'healthy' | 'completed_successfully' | 'failed';
    optional?: boolean;
  }>;
  steps: Record<
    string,
    {
      plan: ExecutionPlan;
      needs: string[];
      waitFor: string[];
      continueOnError?: boolean;
      optional?: boolean;
    }
  >;
  maxParallel: number;
  failFast?: boolean;
  timeoutMs?: number;
  lock?: string;
  policy?: 'once' | 'when_changed' | 'always';
  hooks?: Record<'before' | 'after' | 'on_success' | 'on_failure' | 'finally', ExecutionPlan[]>;
}
export function planExecution(
  config: MinkConfiguration,
  directory: string,
  id: string,
  supplied: Record<string, ParameterValue> = {},
  environment: Record<string, string> = {},
  hiddenEnvironment: string[] = [],
): ExecutionPlan {
  const dependencies = new Map<string, ExecutionPlan>();
  function build(id: string, key: string, values: Record<string, ParameterValue>): ExecutionPlan {
    const entry = Object.hasOwn(config.commands, id) ? config.commands[id] : undefined;
    if (!entry) throw new Error(`Unknown command: ${id}`);
    if (entry.kind === 'command' && entry.disabled)
      throw new Error(`${id} is disabled by the active profile`);
    if (key === id && (entry.private || entry.internal))
      throw new Error(`${id} is private and can only be used as a dependency`);
    const resolved = resolveValues(entry, values, id);
    const plan: ExecutionPlan = {
      id,
      key,
      dependencies: [],
      dependencyRules: [],
      steps: Object.create(null),
      maxParallel: entry.kind === 'pipeline' ? (entry.max_parallel ?? Infinity) : Infinity,
      ...(entry.kind === 'pipeline'
        ? { failFast: entry.fail_fast, timeoutMs: entry.timeout_ms }
        : { lock: entry.lock }),
    };
    if (entry.kind === 'command') {
      plan.entry = structuredClone(entry);
      plan.prepared = prepareEntry(entry, resolved, directory, environment, hiddenEnvironment);
      for (const name of entry.requires ?? [])
        if (plan.prepared.env[name] === undefined && process.env[name] === undefined)
          throw new Error(`${id}: required environment variable ${name} is not set`);
      for (const configured of entry.depends_on ?? []) {
        const dependency = typeof configured === 'string' ? { id: configured } : configured;
        if (!condition(dependency.if, resolved, directory)) continue;
        const dep = dependency.id;
        if (!dependencies.has(dep)) dependencies.set(dep, build(dep, `dependency:${dep}`, {}));
        plan.dependencies.push(dependencies.get(dep)!);
        plan.dependencyRules.push({
          condition: dependency.condition ?? 'completed_successfully',
          optional: dependency.optional,
        });
      }
    } else {
      const variants = Object.entries(entry.steps).flatMap(([stepId, step]) => {
        const matrix = step.matrix ?? (step.for ? { [step.for.var]: step.for.values } : undefined);
        const combinations = matrix ? matrixValues(matrix) : [{}];
        return combinations
          .filter((_variables) => condition(step.if, resolved, directory))
          .map((variables, index) => ({
            id: combinations.length === 1 ? stepId : `${stepId}[${index + 1}]`,
            base: stepId,
            step,
            variables,
          }));
      });
      const expanded = new Map<string, string[]>();
      for (const variant of variants)
        expanded.set(variant.base, [...(expanded.get(variant.base) ?? []), variant.id]);
      for (const variant of variants) {
        const { id: stepId, step, variables } = variant;
        const params: Record<string, ParameterValue> = Object.create(null);
        for (const [name, value] of Object.entries(step.with ?? {})) {
          const ref = typeof value === 'string' && /^\$\{params\.([^}]+)\}$/.exec(value);
          if (ref && !Object.hasOwn(resolved, ref[1]))
            throw new Error(`${id}.${stepId}: parameter ${ref[1]} is inactive or missing`);
          const matrixRef = typeof value === 'string' && /^\$\{matrix\.([^}]+)\}$/.exec(value);
          params[name] = ref
            ? resolved[ref[1]]
            : matrixRef
              ? variables[matrixRef[1]]
              : typeof value === 'string'
                ? value.replace(/\$\{matrix\.([^}]+)\}/g, (match, name: string) =>
                    Object.hasOwn(variables, name) ? String(variables[name]) : match,
                  )
                : value;
        }
        const child = build(step.uses, `${key}/${stepId}`, params);
        child.policy = step.run;
        if (step.timeout_ms) {
          if (child.prepared) child.prepared.timeoutMs = step.timeout_ms;
          else child.timeoutMs = step.timeout_ms;
        }
        if (step.lock) child.lock = step.lock;
        plan.steps[stepId] = {
          plan: child,
          needs: (step.needs ?? []).flatMap((need) => expanded.get(need) ?? []),
          waitFor: (step.wait_for ?? []).flatMap((need) => expanded.get(need) ?? []),
          continueOnError: step.continue_on_error,
          optional: step.optional,
        };
      }
      const list = (value?: string | string[]) =>
        value === undefined ? [] : Array.isArray(value) ? value : [value];
      plan.hooks = {
        before: list(entry.hooks?.before).map((hook, index) =>
          build(hook, `${key}/hook:before:${index}`, {}),
        ),
        after: list(entry.hooks?.after).map((hook, index) =>
          build(hook, `${key}/hook:after:${index}`, {}),
        ),
        on_success: list(entry.hooks?.on_success).map((hook, index) =>
          build(hook, `${key}/hook:on_success:${index}`, {}),
        ),
        on_failure: list(entry.hooks?.on_failure).map((hook, index) =>
          build(hook, `${key}/hook:on_failure:${index}`, {}),
        ),
        finally: list(entry.hooks?.finally).map((hook, index) =>
          build(hook, `${key}/hook:finally:${index}`, {}),
        ),
      };
    }
    return plan;
  }
  return build(id, id, supplied);
}

function matrixValues(
  matrix: Record<string, Array<string | number | boolean>>,
): Array<Record<string, ParameterValue>> {
  return Object.entries(matrix).reduce<Array<Record<string, ParameterValue>>>(
    (items, [name, values]) =>
      items.flatMap((item) => values.map((value) => ({ ...item, [name]: value }))),
    [{}],
  );
}

function condition(
  expression: string | undefined,
  params: Record<string, ParameterValue>,
  directory: string,
): boolean {
  if (!expression) return true;
  const negate = expression.startsWith('!');
  const value = negate ? expression.slice(1) : expression;
  let matched: boolean;
  if (value.startsWith('file:')) matched = existsSync(join(directory, value.slice(5)));
  else if (value.startsWith('binary:')) {
    const names =
      process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT')
            .split(';')
            .map((suffix) => value.slice(7) + suffix)
        : [value.slice(7)];
    matched = (process.env.PATH ?? '')
      .split(delimiter)
      .some((path) => names.some((name) => existsSync(join(path, name))));
  } else if (value.startsWith('os:'))
    matched = value.slice(3) === (process.platform === 'win32' ? 'windows' : process.platform);
  else {
    const match = /^param:([^=]+)=(.*)$/.exec(value);
    if (!match) throw new Error(`Unsupported condition: ${expression}`);
    matched = String(params[match[1]]) === match[2];
  }
  return negate ? !matched : matched;
}

/** Replan failed branches and their prerequisites; never assume an old service still exists. */
export function planFailedBranches(root: ExecutionPlan, previous: RunResult): ExecutionPlan {
  if (previous.state === 'succeeded' || previous.state === 'ready')
    throw new Error('The previous run has no failed branches');
  const successful = (result: RunResult | undefined) =>
    result?.state === 'succeeded' || result?.state === 'ready';
  const prune = (plan: ExecutionPlan, result?: RunResult, force = false): ExecutionPlan => {
    if (plan.entry) return structuredClone(plan);
    if (!result?.steps && result && ['cancelled', 'skipped'].includes(result.state)) force = true;
    const selected = new Map<string, boolean>();
    const include = (name: string, required: boolean) => {
      if (selected.has(name) && (selected.get(name) || !required)) return;
      selected.set(name, required);
      for (const need of plan.steps[name].needs) include(need, true);
    };
    for (const name of Object.keys(plan.steps)) {
      if (!force && !Object.hasOwn(result?.steps ?? {}, name))
        throw new Error('The previous result does not match the current execution graph');
      if (force || !successful(result?.steps?.[name])) include(name, force);
    }
    return {
      ...structuredClone(plan),
      steps: Object.fromEntries(
        [...selected].map(([name, required]) => [
          name,
          {
            needs: [...plan.steps[name].needs],
            waitFor: [...plan.steps[name].waitFor],
            plan: prune(plan.steps[name].plan, result?.steps?.[name], required),
            continueOnError: plan.steps[name].continueOnError,
            optional: plan.steps[name].optional,
          },
        ]),
      ),
    };
  };
  return prune(root, previous);
}

export function mergeRetryResult(previous: RunResult, current: RunResult): RunResult {
  if (!previous.steps || !current.steps) return current;
  return {
    ...current,
    steps: Object.fromEntries(
      Object.entries(previous.steps).map(([name, result]) => [
        name,
        Object.hasOwn(current.steps!, name)
          ? mergeRetryResult(result, current.steps![name])
          : { ...result, reused: true },
      ]),
    ),
  };
}
