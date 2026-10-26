import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ExecutionPlan } from '../commands/plan.js';
import {
  startProcess,
  type ProcessHandle,
  type RunEvent,
  type RunOptions,
  type RunResult,
} from './process.js';
import type { CacheStore } from './cache.js';

interface SessionOptions extends RunOptions {
  cache?: CacheStore;
}

const outcome = (state: 'skipped' | 'cancelled'): RunResult => ({
  exitCode: null,
  signal: null,
  durationMs: 0,
  timedOut: false,
  state,
});
const successful = (r: RunResult) => r.state === 'succeeded' || r.state === 'ready';
export class Session {
  private processes = new Map<string, ProcessHandle>();
  private listeners = new Set<(event: RunEvent) => void>();
  private controllers = new Set<AbortController>();
  private reservedServices = new Map<string, number>();
  private locks = new Map<string, Slots>();
  private runningRoots = new Set<string>();
  private disposed = false;
  subscribe(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  services(): ProcessHandle[] {
    return [...this.processes.values()].filter((p) => p.plan.entry?.run?.mode === 'service');
  }
  private emit = (event: RunEvent): void => {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* Observers cannot corrupt process ownership. */
      }
    }
  };
  async run(root: ExecutionPlan, options: SessionOptions = {}): Promise<RunResult> {
    if (this.disposed) throw new Error('Mink session is disposed');
    if (root.entry && root.entry.run?.mode !== 'service' && this.runningRoots.has(root.id))
      throw new Error(`Command ${root.id} is already running`);
    const serviceCounts = new Map<string, number>();
    for (const service of this.services().filter((p) =>
      ['ready', 'unhealthy', 'starting', 'stopping'].includes(p.state),
    ))
      serviceCounts.set(service.id, (serviceCounts.get(service.id) ?? 0) + 1);
    for (const [id, count] of this.reservedServices)
      serviceCounts.set(id, (serviceCounts.get(id) ?? 0) + count);
    const reservations: string[] = [];
    const inspect = (plan: ExecutionPlan): void => {
      if (plan.entry?.run?.mode === 'service') {
        const count = serviceCounts.get(plan.id) ?? 0;
        if (count >= (plan.entry.run.replicas ?? 1))
          throw new Error(`Service ${plan.id} is already scheduled or running; use restart`);
        serviceCounts.set(plan.id, count + 1);
        reservations.push(plan.id);
      }
      for (const p of plan.dependencies) inspect(p);
      for (const s of Object.values(plan.steps)) inspect(s.plan);
    };
    inspect(root);
    if (root.entry) this.runningRoots.add(root.id);
    for (const id of reservations)
      this.reservedServices.set(id, (this.reservedServices.get(id) ?? 0) + 1);
    const started = Date.now(),
      runId = randomUUID(),
      controller = new AbortController();
    this.controllers.add(controller);
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const pool = new Slots(root.maxParallel),
      dependencyRuns = new Map<string, Promise<RunResult>>(),
      onceRuns = new Map<string, Promise<RunResult>>();
    const dependencyController = new AbortController();
    let dependencySignal = AbortSignal.any([signal, dependencyController.signal]);
    const notify = (event: RunEvent) => {
      options.cache?.observe(event);
      this.emit(event);
      try {
        options.onEvent?.(event);
      } catch {
        /* Isolate observer errors. */
      }
    };
    const execute = async (plan: ExecutionPlan, scope = signal): Promise<RunResult> => {
      if (scope.aborted) return outcome('cancelled');
      if (!plan.entry) {
        const branch = new AbortController();
        const branchSignal = AbortSignal.any([scope, branch.signal]);
        if (plan === root)
          dependencySignal = AbortSignal.any([branchSignal, dependencyController.signal]);
        let failed = false,
          timedOut = false;
        const deadline = plan.timeoutMs
          ? setTimeout(() => {
              timedOut = true;
              branch.abort();
            }, plan.timeoutMs)
          : undefined;
        const runs = new Map<string, Promise<RunResult>>();
        const hookResults: Array<[string, RunResult]> = [];
        const hooks = async (
          kind: 'before' | 'after' | 'on_success' | 'on_failure' | 'finally',
          hookSignal: AbortSignal,
        ) => {
          let ok = true;
          for (const [index, hook] of (plan.hooks?.[kind] ?? []).entries()) {
            const result = await execute(hook, hookSignal);
            hookResults.push([`hook:${kind}:${index + 1}`, result]);
            ok &&= successful(result);
          }
          return ok;
        };
        const step = (id: string): Promise<RunResult> => {
          if (!runs.has(id))
            runs.set(
              id,
              (async () => {
                await Promise.all(plan.steps[id].waitFor.map(step));
                const needs = await Promise.all(plan.steps[id].needs.map(step));
                if (branchSignal.aborted) return outcome('cancelled');
                if (
                  needs.some(
                    (result, index) =>
                      !successful(result) &&
                      !plan.steps[plan.steps[id].needs[index]].continueOnError &&
                      !plan.steps[plan.steps[id].needs[index]].optional,
                  )
                )
                  return outcome('skipped');
                const result = await execute(plan.steps[id].plan, branchSignal);
                if (
                  result.state === 'failed' &&
                  plan.failFast &&
                  !plan.steps[id].continueOnError &&
                  !plan.steps[id].optional
                ) {
                  failed = true;
                  branch.abort();
                }
                return result;
              })(),
            );
          return runs.get(id)!;
        };
        const begin = Date.now(),
          names = Object.keys(plan.steps),
          beforeOk = await hooks('before', branchSignal),
          results = await (
            beforeOk
              ? Promise.all(names.map(step))
              : Promise.resolve(names.map(() => outcome('skipped')))
          ).finally(() => {
            if (deadline) clearTimeout(deadline);
          });
        let success =
          beforeOk &&
          results.every(
            (result, index) =>
              successful(result) ||
              plan.steps[names[index]].continueOnError ||
              plan.steps[names[index]].optional,
          );
        success = (await hooks('after', scope)) && success;
        success = (await hooks(success ? 'on_success' : 'on_failure', scope)) && success;
        const cleanupSignal = new AbortController().signal;
        success = (await hooks('finally', cleanupSignal)) && success;
        return {
          exitCode: success ? 0 : 1,
          signal: null,
          durationMs: Date.now() - begin,
          timedOut: timedOut || results.some((r) => r.timedOut),
          state: scope.aborted
            ? 'cancelled'
            : !failed && !timedOut && success
              ? 'succeeded'
              : 'failed',
          steps: Object.fromEntries([
            ...names.map((name, i) => [name, results[i]] as const),
            ...hookResults,
          ]),
        };
      }
      for (const [index, dep] of plan.dependencies.entries()) {
        if (!dependencyRuns.has(dep.key))
          dependencyRuns.set(dep.key, execute(dep, dependencySignal));
        const result = await untilCancelled(dependencyRuns.get(dep.key)!, scope);
        const rule = plan.dependencyRules[index];
        const accepted =
          rule.condition === 'failed'
            ? result.state === 'failed'
            : rule.condition === 'completed_successfully'
              ? result.state === 'succeeded'
              : successful(result);
        if (!accepted && !rule.optional)
          return { ...result, state: scope.aborted ? 'cancelled' : 'failed' };
      }
      if (plan.policy === 'once') {
        const key = JSON.stringify({
          id: plan.id,
          command: plan.prepared?.command,
          args: plan.prepared?.args,
          env: plan.prepared?.env,
        });
        const reused = onceRuns.has(key);
        if (!reused) onceRuns.set(key, execute({ ...plan, policy: undefined }, scope));
        const result = await untilCancelled(onceRuns.get(key)!, scope);
        return reused ? { ...result, reused: true } : result;
      }
      if (!options.force && plan.policy !== 'always') {
        const cached = await options.cache?.lookup(plan);
        if (cached?.entry) {
          for (const event of cached.entry.events)
            notify({
              type: event.type,
              runId,
              instance: `${runId}:${plan.key}`,
              id: plan.id,
              time: Date.now(),
              ...(event.chunk ? { chunk: event.chunk } : {}),
            });
          return { ...cached.entry.result, durationMs: 0, cached: true };
        }
      }
      const retry = plan.entry.run?.retry;
      const begin = Date.now();
      const lockName = plan.lock;
      if (lockName && !this.locks.has(lockName)) this.locks.set(lockName, new Slots(1));
      const lock = lockName ? this.locks.get(lockName)! : undefined;
      if (lock && !(await lock.acquire(scope))) return outcome('cancelled');
      try {
        for (let attempt = 1; attempt <= (retry?.attempts ?? 1); attempt++) {
          if (!(await pool.acquire(scope))) return outcome('cancelled');
          let result: RunResult;
          try {
            if (scope.aborted) return outcome('cancelled');
            const instance = `${runId}:${plan.key}`;
            const handle = startProcess(
              plan,
              runId,
              instance,
              { ...options, signal: scope },
              notify,
              async (restartSignal) => {
                if (!(await pool.acquire(restartSignal)))
                  throw new Error('Service restart cancelled');
                return () => pool.release();
              },
            );
            if (plan.entry.run?.mode === 'service') {
              for (const [key, old] of this.processes) {
                if (old.id === plan.id && ['stopped', 'failed'].includes(old.state))
                  this.processes.delete(key);
              }
            }
            this.processes.set(instance, handle);
            void handle.completion.then(() => {
              if (plan.entry?.run?.mode !== 'service') this.processes.delete(instance);
            });
            result = await handle.ready;
          } finally {
            pool.release();
          }
          await options.cache?.store(plan, `${runId}:${plan.key}`, result);
          if (result.state !== 'failed' || attempt === (retry?.attempts ?? 1))
            return {
              ...result,
              durationMs: Date.now() - begin,
              ...(retry ? { attempts: attempt } : {}),
            };
          try {
            const base = Math.min(
              60000,
              (retry?.delay_ms ?? 100) * (retry?.backoff ?? 2) ** (attempt - 1),
            );
            await delay(base + Math.floor(Math.random() * Math.max(1, base * 0.2)), undefined, {
              signal: scope,
            });
          } catch {
            return outcome('cancelled');
          }
        }
      } finally {
        lock?.release();
      }
      return outcome('cancelled');
    };
    try {
      const result = await execute(root);
      // A nested deadline can stop waiting on a shared prerequisite. Keep it
      // available to other branches, then clean up any unused work before return.
      dependencyController.abort();
      await Promise.all(dependencyRuns.values());
      return { ...result, durationMs: Date.now() - started };
    } finally {
      dependencyController.abort();
      // Services retain their controller until session disposal.
      for (const id of reservations) {
        const count = (this.reservedServices.get(id) ?? 1) - 1;
        if (count) this.reservedServices.set(id, count);
        else this.reservedServices.delete(id);
      }
      if (root.entry) this.runningRoots.delete(root.id);
      const live = this.services().filter(
        (p) =>
          p.instance.startsWith(runId) &&
          ['ready', 'unhealthy', 'starting', 'stopping'].includes(p.state),
      );
      if (!live.length) this.controllers.delete(controller);
      else
        void Promise.all(live.map((p) => p.completion)).then(() =>
          this.controllers.delete(controller),
        );
    }
  }
  async stop(instance: string, force = false): Promise<void> {
    const process = this.processes.get(instance);
    if (!process) throw new Error(`Unknown owned process: ${instance}`);
    process.stop(force);
    await process.completion;
  }
  async restart(instance: string): Promise<RunResult> {
    const old = this.processes.get(instance);
    if (!old || old.plan.entry?.run?.mode !== 'service') throw new Error('Unknown service');
    await this.stop(instance);
    this.processes.delete(instance);
    return this.run({ ...old.plan, dependencies: [] }, { stdin: old.options.stdin });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    const handles = [...this.processes.values()];
    for (const handle of handles) handle.stop();
    await Promise.all(handles.map((h) => h.completion));
    this.controllers.clear();
    this.listeners.clear();
  }
}
function untilCancelled(result: Promise<RunResult>, signal: AbortSignal): Promise<RunResult> {
  if (signal.aborted) return Promise.resolve(outcome('cancelled'));
  return new Promise((resolve, reject) => {
    const abort = () => resolve(outcome('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    void result.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}
class Slots {
  private active = 0;
  private waiters = new Set<() => void>();
  constructor(private readonly limit: number) {}
  async acquire(signal: AbortSignal): Promise<boolean> {
    while (this.active >= this.limit && !signal.aborted)
      await new Promise<void>((resolve) => {
        const wake = () => {
          this.waiters.delete(wake);
          signal.removeEventListener('abort', wake);
          resolve();
        };
        this.waiters.add(wake);
        signal.addEventListener('abort', wake, { once: true });
        if (signal.aborted) wake();
      });
    if (signal.aborted) return false;
    this.active++;
    return true;
  }
  release(): void {
    this.active--;
    this.waiters.values().next().value?.();
  }
}
