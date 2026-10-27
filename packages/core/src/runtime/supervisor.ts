import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import type { Mink, ParameterValue, RunEvent, RunResult } from '../index.js';
import type { ExecutionPlan } from '../commands/plan.js';
import { redactSecrets } from './log.js';
import { stateRoot } from '../storage.js';

export type SupervisorRequest =
  | { id: string; action: 'ping' | 'status' | 'history' }
  | { id: string; action: 'run'; command: string; values?: Record<string, ParameterValue> }
  | { id: string; action: 'stop'; instance?: string; all?: boolean; force?: boolean }
  | { id: string; action: 'scale'; service: string; count: number }
  | { id: string; action: 'disable'; service: string; disabled: boolean }
  | { id: string; action: 'logs' | 'events'; owner?: string; limit?: number };

type SupervisorCommand = SupervisorRequest extends infer Request
  ? Request extends SupervisorRequest
    ? Omit<Request, 'id'>
    : never
  : never;

export interface SupervisorResponse {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: { code: string; message: string };
}

export function supervisorEndpoint(configFile: string, directory?: string): string {
  const id = createHash('sha256').update(resolve(configFile)).digest('hex').slice(0, 20);
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\mink-${id}`
    : join(stateRoot(directory), `supervisor-${id}.sock`);
}

export class SupervisorServer {
  private server?: Server;
  private readonly events: RunEvent[] = [];
  private readonly plans = new Map<string, ExecutionPlan>();
  private unsubscribe?: () => void;
  private readonly schedules: Array<ReturnType<typeof setInterval>> = [];
  private readonly disabled = new Set<string>();
  constructor(
    private readonly mink: Mink,
    readonly endpoint: string,
  ) {}
  async listen(): Promise<void> {
    if (this.server) return;
    if (process.platform !== 'win32') {
      await mkdir(dirname(this.endpoint), { recursive: true, mode: 0o700 });
      await unlink(this.endpoint).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    this.unsubscribe = this.mink.subscribe((event) => {
      const plan = this.plans.get(event.id);
      this.events.push({
        ...event,
        ...(event.chunk && plan ? { chunk: redactSecrets(event.chunk, plan) } : {}),
      });
      if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    });
    this.server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.endpoint, resolve);
    });
    if (process.platform !== 'win32') await chmod(this.endpoint, 0o600);
    for (const [id, entry] of Object.entries(this.mink.getConfig().commands)) {
      if (entry.kind !== 'command') continue;
      if (entry.disabled || entry.run?.disabled) this.disabled.add(id);
      const schedule = entry.run?.schedule;
      if (!schedule) continue;
      const milliseconds =
        schedule.interval_ms ??
        (() => {
          const match = /^\*\/(\d+) \* \* \* \*$/.exec(schedule.cron ?? '');
          if (!match) throw new Error(`${id}: minimal cron supports */N * * * *`);
          return Number(match[1]) * 60000;
        })();
      this.schedules.push(
        setInterval(() => {
          if (!this.disabled.has(id))
            void this.mink.run(id, {}, { approved: true }).catch(() => {});
        }, milliseconds),
      );
    }
  }
  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.schedules.splice(0)) clearInterval(timer);
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    await this.mink.dispose();
    if (process.platform !== 'win32') await unlink(this.endpoint).catch(() => {});
  }
  private accept(socket: Socket): void {
    socket.setEncoding('utf8');
    let pending = '';
    socket.on('data', (chunk: string) => {
      pending += chunk;
      for (;;) {
        const end = pending.indexOf('\n');
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        void this.handleLine(line).then((response) =>
          socket.write(`${JSON.stringify(response)}\n`),
        );
      }
    });
  }
  private async handleLine(line: string): Promise<SupervisorResponse> {
    let request: SupervisorRequest;
    try {
      request = JSON.parse(line) as SupervisorRequest;
      if (!request.id || !request.action) throw new Error('Malformed request');
    } catch (error) {
      return { id: '', ok: false, error: { code: 'INVALID_REQUEST', message: String(error) } };
    }
    try {
      let value: unknown;
      if (request.action === 'ping') value = { pid: process.pid };
      else if (request.action === 'status')
        value = {
          pid: process.pid,
          services: this.mink.services(),
          configFile: this.mink.configFile,
        };
      else if (request.action === 'history') value = (await this.mink.state()).history;
      else if (request.action === 'run') {
        if (this.disabled.has(request.command)) throw new Error(`${request.command} is disabled`);
        const plan = this.mink.plan(request.command, request.values);
        this.plans.set(plan.id, plan);
        value = await this.mink.run(request.command, request.values, { approved: true });
      } else if (request.action === 'stop') {
        const services = this.mink
          .services()
          .filter((service) => request.all || service.instance === request.instance);
        if (!services.length) throw new Error('No matching service');
        await Promise.all(
          services.map((service) => this.mink.stopService(service.instance, request.force)),
        );
        value = { stopped: services.map((service) => service.instance) };
      } else if (request.action === 'scale') {
        value = await this.mink.scaleService(request.service, request.count);
      } else if (request.action === 'disable') {
        if (request.disabled) this.disabled.add(request.service);
        else this.disabled.delete(request.service);
        value = { service: request.service, disabled: request.disabled };
      } else if (request.action === 'logs' || request.action === 'events') {
        const limit = Math.min(10000, Math.max(1, request.limit ?? 200));
        value = this.events
          .filter((event) => !request.owner || event.id === request.owner)
          .filter(
            (event) =>
              request.action === 'events' || event.type === 'stdout' || event.type === 'stderr',
          )
          .slice(-limit);
      }
      return { id: request.id, ok: true, value };
    } catch (error) {
      return {
        id: request.id,
        ok: false,
        error: {
          code: 'SUPERVISOR_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

export class SupervisorClient {
  constructor(readonly endpoint: string) {}
  request<T = unknown>(request: SupervisorCommand): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const socket = createConnection(this.endpoint);
      let pending = '';
      socket.setEncoding('utf8');
      socket.once('error', reject);
      socket.on('data', (chunk: string) => {
        pending += chunk;
        const end = pending.indexOf('\n');
        if (end < 0) return;
        socket.end();
        try {
          const response = JSON.parse(pending.slice(0, end)) as SupervisorResponse;
          if (!response.ok)
            reject(new Error(response.error?.message ?? 'Supervisor request failed'));
          else resolve(response.value as T);
        } catch (error) {
          reject(error);
        }
      });
      socket.once('connect', () => socket.write(`${JSON.stringify({ ...request, id })}\n`));
    });
  }
  ping(): Promise<{ pid: number }> {
    return this.request({ action: 'ping' });
  }
  run(command: string, values?: Record<string, ParameterValue>): Promise<RunResult> {
    return this.request({ action: 'run', command, values });
  }
}
