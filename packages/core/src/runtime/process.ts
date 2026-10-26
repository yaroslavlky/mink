import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { ExecutionPlan } from '../commands/plan.js';
import { spawnOwned } from './platform.js';

export type RunState = 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'ready';
export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  state: RunState;
  error?: string;
  steps?: Record<string, RunResult>;
  attempts?: number;
  reused?: boolean;
  cached?: boolean;
}
export interface RunEvent {
  type: 'start' | 'stdout' | 'stderr' | 'ready' | 'finish' | 'health' | 'restart';
  runId: string;
  instance: string;
  id: string;
  time: number;
  chunk?: string;
  result?: RunResult;
  healthy?: boolean;
}
export interface RunOptions {
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  stdin?: 'inherit' | 'ignore';
  retryFailed?: RunResult;
  force?: boolean;
  args?: string[];
  approved?: boolean;
}
export interface ProcessHandle {
  instance: string;
  id: string;
  state: 'starting' | 'ready' | 'unhealthy' | 'stopping' | 'stopped' | 'failed';
  started: number;
  url?: string;
  ready: Promise<RunResult>;
  completion: Promise<RunResult>;
  stop: (force?: boolean) => void;
  plan: ExecutionPlan;
  options: RunOptions;
  readonly restarts: number;
  readonly healthHistory: Array<{ time: number; healthy: boolean }>;
}

export type ServiceInfo = Readonly<
  Pick<
    ProcessHandle,
    'instance' | 'id' | 'state' | 'started' | 'url' | 'completion' | 'restarts' | 'healthHistory'
  >
>;

export function startProcess(
  plan: ExecutionPlan,
  runId: string,
  instance: string,
  options: RunOptions,
  notify: (event: RunEvent) => void,
  restartSlot?: (signal: AbortSignal) => Promise<() => void>,
): ProcessHandle {
  const policy = plan.entry?.run?.restart;
  if (!policy || policy.policy === 'never')
    return startSingleProcess(plan, runId, instance, options, notify);
  const maxAttempts = policy.max_attempts ?? 3;
  const started = Date.now();
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let current: ProcessHandle | undefined;
  let state: ProcessHandle['state'] | undefined;
  let attempt = 0;
  let force = false,
    everReady = false;
  let ready!: (result: RunResult) => void;
  const readiness = new Promise<RunResult>((resolve) => {
    ready = resolve;
  });
  const completion = (async (): Promise<RunResult> => {
    let result: RunResult = {
      exitCode: null,
      signal: null,
      durationMs: 0,
      timedOut: false,
      state: 'cancelled',
    };
    try {
      for (; attempt <= maxAttempts && !signal.aborted; attempt++) {
        if (attempt) {
          state = 'starting';
          await delay(
            Math.min(60000, (policy.delay_ms ?? 500) * (policy.backoff ?? 2) ** (attempt - 1)),
            undefined,
            { signal },
          );
          notify({ type: 'restart', runId, instance, id: plan.id, time: Date.now() });
        }
        const release = attempt && everReady && restartSlot ? await restartSlot(signal) : undefined;
        try {
          if (signal.aborted) break;
          current = startSingleProcess(plan, runId, instance, { ...options, signal }, notify);
          state = undefined;
          const initial = await current.ready;
          if (initial.state === 'ready') {
            everReady = true;
            ready({ ...initial, attempts: attempt + 1 });
          }
        } finally {
          release?.();
        }
        result = await current!.completion;
        if (policy.policy !== 'always' && result.state !== 'failed') break;
        if (policy.policy === 'exit_on_failure') break;
      }
    } catch (error) {
      result = {
        ...result,
        state: signal.aborted ? 'cancelled' : 'failed',
        ...(signal.aborted ? {} : { error: String(error) }),
      };
    }
    if (signal.aborted) result = { ...result, state: 'cancelled' };
    state = result.state === 'failed' ? 'failed' : 'stopped';
    result = {
      ...result,
      durationMs: Date.now() - started,
      attempts: Math.min(attempt + 1, maxAttempts + 1),
    };
    ready(result);
    return result;
  })();
  return {
    instance,
    id: plan.id,
    started,
    url: plan.entry?.run?.ready?.url ?? plan.entry?.run?.health?.url,
    get state() {
      return state ?? current?.state ?? 'starting';
    },
    ready: readiness,
    completion,
    plan,
    options,
    get restarts() {
      return Math.max(0, attempt);
    },
    get healthHistory() {
      return current?.healthHistory ?? [];
    },
    stop(immediate = false) {
      if (state === 'failed' || state === 'stopped') return;
      force ||= immediate;
      state = 'stopping';
      controller.abort();
      current?.stop(force);
    },
  };
}

function startSingleProcess(
  plan: ExecutionPlan,
  runId: string,
  instance: string,
  options: RunOptions,
  notify: (event: RunEvent) => void,
): ProcessHandle {
  const started = Date.now(),
    entry = plan.entry!,
    prepared = plan.prepared!,
    service = entry.run?.mode === 'service';
  const probeAbort = new AbortController();
  let timedOut = false,
    cancelled = false,
    finished = false,
    isReady = false;
  let failure: string | undefined;
  let observedOutput = '';
  let timer: ReturnType<typeof setTimeout> | undefined,
    escalation: ReturnType<typeof setTimeout> | undefined;
  let complete!: (result: RunResult) => void, ready!: (result: RunResult) => void;
  const completion = new Promise<RunResult>((r) => {
      complete = r;
    }),
    readiness = new Promise<RunResult>((r) => {
      ready = r;
    });
  const emit = (type: RunEvent['type'], extra: Partial<RunEvent> = {}) =>
    notify({ type, runId, instance, id: plan.id, time: Date.now(), ...extra });
  const handle: ProcessHandle = {
    instance,
    id: plan.id,
    state: 'starting',
    started,
    url: entry.run?.ready?.url ?? entry.run?.health?.url,
    ready: service ? readiness : completion,
    completion,
    stop,
    plan,
    options,
    restarts: 0,
    healthHistory: [],
  };
  const child = spawnOwned(prepared, options.stdin ?? 'ignore', (stream, chunk) => {
    observedOutput = (observedOutput + chunk).slice(-65536);
    emit(stream, { chunk });
  });
  function stop(force = false): void {
    if (finished) return;
    cancelled = !timedOut;
    handle.state = 'stopping';
    child.stop(force);
    if (!force && !escalation) escalation = setTimeout(() => child.stop(true), 800);
  }
  const abort = () => stop();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) stop();
  function finish(exitCode: number | null, signal: NodeJS.Signals | null, error?: string): void {
    if (finished) return;
    finished = true;
    probeAbort.abort();
    if (timer) clearTimeout(timer);
    if (escalation) clearTimeout(escalation);
    options.signal?.removeEventListener('abort', abort);
    const state: RunState = cancelled
      ? 'cancelled'
      : !timedOut && !error && !failure && exitCode === 0 && (!service || isReady)
        ? 'succeeded'
        : 'failed';
    const result: RunResult = {
      exitCode,
      signal,
      durationMs: Date.now() - started,
      timedOut,
      state,
      ...(error || failure ? { error: error ?? failure } : {}),
    };
    handle.state = state === 'failed' ? 'failed' : 'stopped';
    ready(result);
    complete(result);
    emit('finish', { result });
  }
  timer = setTimeout(() => {
    timedOut = true;
    stop(true);
  }, 30000);
  void child.completion.then(({ code, signal, error }) => finish(code, signal, error));
  void child.started.then(() => {
    if (finished) return;
    if (timer) clearTimeout(timer);
    emit('start');
    if (options.signal?.aborted) {
      stop();
      return;
    }
    const timeout = service ? (entry.run?.startup_timeout_ms ?? 30000) : prepared.timeoutMs;
    if (timeout)
      timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, timeout);
    if (service) void waitUntilReady();
  });
  async function waitUntilReady(): Promise<void> {
    const check =
      entry.run?.ready ??
      (entry.run?.ready_log_line
        ? ({ type: 'log', log_line: entry.run.ready_log_line } as const)
        : undefined);
    try {
      while (!finished && !probeAbort.signal.aborted) {
        const ok = !check || (await probe(check, probeAbort.signal, prepared.cwd, observedOutput));
        if (finished || handle.state === 'stopping') return;
        if (ok) {
          isReady = true;
          handle.state = 'ready';
          if (timer) clearTimeout(timer);
          const result: RunResult = {
            exitCode: 0,
            signal: null,
            durationMs: Date.now() - started,
            timedOut: false,
            state: 'ready',
          };
          ready(result);
          emit('ready', { result });
          if (entry.run?.health) void monitorHealth();
          return;
        }
        await delay(('interval_ms' in check ? check.interval_ms : undefined) ?? 100, undefined, {
          signal: probeAbort.signal,
        });
      }
    } catch (error) {
      if (!probeAbort.signal.aborted) {
        emit('stderr', { chunk: `Readiness failed: ${String(error)}\n` });
        stop();
      }
    }
  }
  async function monitorHealth(): Promise<void> {
    const check = entry.run!.health!;
    let failures = 0;
    try {
      while (!probeAbort.signal.aborted) {
        await delay(check.interval_ms ?? 1000, undefined, { signal: probeAbort.signal });
        const healthy = await probe(check, probeAbort.signal, prepared.cwd, observedOutput);
        if (finished || handle.state === 'stopping') return;
        failures = healthy ? 0 : failures + 1;
        if (!healthy && failures < (check.failure_threshold ?? 3)) continue;
        const next = healthy ? 'ready' : 'unhealthy';
        if (handle.state !== next) {
          handle.state = next;
          handle.healthHistory.push({ time: Date.now(), healthy });
          if (handle.healthHistory.length > 100) handle.healthHistory.shift();
          emit('health', { healthy });
        }
        if (!healthy && entry.run?.restart) {
          failure = 'Service health check failed';
          child.stop(false);
          escalation = setTimeout(() => child.stop(true), 800);
          return;
        }
      }
    } catch (error) {
      if (!probeAbort.signal.aborted)
        emit('stderr', { chunk: `Health check failed: ${String(error)}\n` });
    }
  }
  return handle;
}
async function probe(
  check: NonNullable<NonNullable<ExecutionPlan['entry']>['run']>['ready'],
  signal: AbortSignal,
  cwd?: string,
  output = '',
): Promise<boolean> {
  if (!check || check.type === 'process') return true;
  if (check.type === 'tcp') return tcpReady(check.host ?? '127.0.0.1', check.port!, signal);
  if (check.type === 'file') return existsSync(resolve(cwd ?? process.cwd(), check.file!));
  if (check.type === 'log') return output.includes(check.log_line!);
  if (check.type === 'command') {
    const handle = spawnOwned(
      { command: check.command!, args: [], env: {}, cwd },
      'ignore',
      () => {},
    );
    const result = await handle.completion;
    return result.code === 0;
  }
  try {
    const response = await fetch(check.url!, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
      redirect: 'error',
    });
    const ok = response.ok;
    await response.body?.cancel();
    return ok;
  } catch {
    return false;
  }
}
async function tcpReady(host: string, port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      socket.destroy();
      resolve(ok);
    };
    const abort = () => finish(false);
    signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(500, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    if (signal.aborted) finish(false);
  });
}
