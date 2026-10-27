import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  createMink,
  describePlan,
  type Mink,
  type ParameterValue,
  type RunEvent,
  type ExecutionPlan,
} from '@yaroslavlky/mink-core';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Request {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: { name?: string; uri?: string; arguments?: Record<string, unknown> };
}
interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface McpOptions {
  cwd?: string;
  configFile?: string;
  readOnly?: boolean;
  allow?: string[];
  approve?: boolean;
  maxRuns?: number;
  timeoutMs?: number;
  logLimit?: number;
}

const tools: Tool[] = [
  tool('list', 'List commands'),
  tool('plan', 'Resolve a redacted execution plan', { id: { type: 'string' }, values: object() }, [
    'id',
  ]),
  tool(
    'run',
    'Run an allowed command',
    { id: { type: 'string' }, values: object(), approved: { type: 'boolean' } },
    ['id'],
  ),
  tool(
    'cancel',
    'Cancel an active run',
    { runId: { type: 'string' }, approved: { type: 'boolean' } },
    ['runId'],
  ),
  tool(
    'logs',
    'Read a bounded redacted log tail',
    { runId: { type: 'string' }, lines: { type: 'number' } },
    ['runId'],
  ),
  tool('status', 'Show active runs and services'),
  tool('services', 'Show managed services'),
  tool('history', 'Show recent runs'),
];
function object(): Record<string, unknown> {
  return { type: 'object', additionalProperties: true };
}
function tool(
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      additionalProperties: false,
      ...(required.length ? { required } : {}),
    },
  };
}

export class MinkMcpServer {
  private readonly controllers = new Map<string, AbortController>();
  private readonly logs = new Map<string, RunEvent[]>();
  private runs = 0;
  constructor(
    private readonly mink: Mink,
    private readonly options: McpOptions = {},
  ) {}
  async handle(request: Request): Promise<unknown> {
    if (request.method === 'initialize')
      return {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'mink', version: '1.0.0' },
      };
    if (request.method === 'ping') return {};
    if (request.method === 'tools/list') return { tools };
    if (request.method === 'resources/list')
      return {
        resources: [
          resource('mink://schema', 'Configuration schema'),
          resource('mink://graph', 'Current command graph'),
          resource('mink://runs/latest', 'Latest runs'),
        ],
      };
    if (request.method === 'resources/read')
      return this.resource(String(request.params?.uri ?? ''));
    if (request.method === 'prompts/list')
      return {
        prompts: [
          {
            name: 'fix-failed-step',
            description: 'Inspect the latest failed step and propose a bounded fix',
            arguments: [],
          },
        ],
      };
    if (request.method === 'prompts/get')
      return {
        description: 'Repair a failed Mink step',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Read mink://runs/latest, inspect bounded logs with the logs tool, propose the smallest fix, then run only the affected command.',
            },
          },
        ],
      };
    if (request.method === 'tools/call')
      return this.call(String(request.params?.name ?? ''), request.params?.arguments ?? {});
    throw structured('METHOD_NOT_FOUND', `Unsupported MCP method: ${request.method}`);
  }
  private async call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    try {
      let value: unknown;
      if (name === 'list')
        value = this.mink
          .searchCommands('')
          .map(({ id, entry }) => ({ id, name: entry.name, kind: entry.kind }));
      else if (name === 'plan')
        value = describePlan(this.mink.plan(this.allowedId(args), values(args)));
      else if (name === 'run')
        value = await this.run(this.allowedId(args), values(args), args.approved === true);
      else if (name === 'cancel')
        value = this.cancel(String(args.runId ?? ''), args.approved === true);
      else if (name === 'logs')
        value = this.tail(
          String(args.runId ?? ''),
          Number(args.lines ?? this.options.logLimit ?? 200),
        );
      else if (name === 'status')
        value = { runs: [...this.controllers.keys()], services: this.serializedServices() };
      else if (name === 'services') value = this.serializedServices();
      else if (name === 'history') value = (await this.mink.state()).history;
      else throw structured('TOOL_NOT_FOUND', `Unknown tool: ${name}`);
      return { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } catch (error) {
      const detail = error instanceof Error ? error : new Error(String(error));
      return {
        content: [
          { type: 'text', text: JSON.stringify({ code: 'MINK_ERROR', message: detail.message }) },
        ],
        isError: true,
      };
    }
  }
  private allowedId(args: Record<string, unknown>): string {
    const id = String(args.id ?? '');
    const entry = this.mink.getConfig().commands[id];
    if (!entry) throw structured('UNKNOWN_COMMAND', `Unknown command: ${id}`);
    const allow = this.options.allow ?? [];
    if (
      allow.length &&
      !allow.includes(id) &&
      !(entry.tags ?? []).some((tag) => allow.includes(tag))
    )
      throw structured('DENIED', `${id} is outside the MCP allow list`);
    return id;
  }
  private async run(
    id: string,
    values: Record<string, ParameterValue>,
    approved: boolean,
  ): Promise<unknown> {
    if (this.options.readOnly) throw structured('READ_ONLY', 'The MCP server is read-only');
    if (this.options.approve && !approved)
      throw structured('APPROVAL_REQUIRED', 'This action requires approval');
    if (this.runs >= (this.options.maxRuns ?? 20))
      throw structured('RUN_LIMIT', 'MCP run limit reached');
    this.runs++;
    const runId = `${Date.now()}-${this.runs}`;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    this.logs.set(runId, []);
    const secrets = planSecrets(this.mink.plan(id, values));
    const timeout = this.options.timeoutMs
      ? setTimeout(() => controller.abort(), this.options.timeoutMs)
      : undefined;
    try {
      const result = await this.mink.run(id, values, {
        signal: controller.signal,
        approved,
        onEvent: (event) => {
          const events = this.logs.get(runId)!;
          events.push(cleanEvent(event, secrets));
          if (events.length > (this.options.logLimit ?? 200)) events.shift();
        },
      });
      return { runId, result };
    } finally {
      if (timeout) clearTimeout(timeout);
      this.controllers.delete(runId);
    }
  }
  private cancel(runId: string, approved: boolean): { cancelled: boolean } {
    if (this.options.readOnly) throw structured('READ_ONLY', 'The MCP server is read-only');
    if (this.options.approve && !approved)
      throw structured('APPROVAL_REQUIRED', 'This action requires approval');
    const controller = this.controllers.get(runId);
    controller?.abort();
    return { cancelled: !!controller };
  }
  private tail(runId: string, lines: number): RunEvent[] {
    return (this.logs.get(runId) ?? []).slice(-Math.min(1000, Math.max(1, lines)));
  }
  private serializedServices(): unknown[] {
    return this.mink.services().map(({ completion: _completion, ...service }) => service);
  }
  private async resource(uri: string): Promise<unknown> {
    let value: unknown;
    if (uri === 'mink://schema') {
      const file = createRequire(import.meta.url).resolve('@yaroslavlky/mink-core/schema');
      value = JSON.parse(await readFile(file, 'utf8')) as Json;
    } else if (uri === 'mink://graph') value = this.mink.graph();
    else if (uri === 'mink://runs/latest') value = (await this.mink.state()).history.slice(0, 20);
    else throw structured('RESOURCE_NOT_FOUND', `Unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value) }] };
  }
}

function resource(uri: string, name: string): { uri: string; name: string; mimeType: string } {
  return { uri, name, mimeType: 'application/json' };
}
function values(args: Record<string, unknown>): Record<string, ParameterValue> {
  return args.values && typeof args.values === 'object' && !Array.isArray(args.values)
    ? (args.values as Record<string, ParameterValue>)
    : {};
}
function planSecrets(plan: ExecutionPlan): string[] {
  const values = new Set<string>();
  const visit = (node: ExecutionPlan): void => {
    for (const name of node.prepared?.hiddenEnv ?? []) {
      const value = node.prepared?.env[name];
      if (value) values.add(value);
    }
    node.dependencies.forEach(visit);
    Object.values(node.steps).forEach((step) => visit(step.plan));
  };
  visit(plan);
  return [...values].sort((left, right) => right.length - left.length);
}
function cleanEvent(event: RunEvent, secrets: string[]): RunEvent {
  const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
  const chunk = secrets.reduce(
    (text, secret) => text.replaceAll(secret, '[hidden]'),
    event.chunk ?? '',
  );
  return {
    ...event,
    ...(event.chunk ? { chunk: chunk.replaceAll(ansi, '').slice(0, 10000) } : {}),
  };
}
function structured(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function runMcpServer(options: McpOptions = {}): Promise<void> {
  const mink = await createMink({ cwd: options.cwd, configFile: options.configFile });
  const server = new MinkMcpServer(mink, options);
  let buffer = Buffer.alloc(0);
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    void consume();
  });
  const consume = async (): Promise<void> => {
    for (;;) {
      const header = buffer.indexOf('\r\n\r\n');
      if (header < 0) return;
      const match = /Content-Length: (\d+)/i.exec(buffer.subarray(0, header).toString());
      if (!match) throw new Error('Missing Content-Length');
      const length = Number(match[1]);
      if (buffer.length < header + 4 + length) return;
      const body = buffer.subarray(header + 4, header + 4 + length).toString();
      buffer = buffer.subarray(header + 4 + length);
      const request = JSON.parse(body) as Request;
      if (request.id === undefined) continue;
      try {
        send({ jsonrpc: '2.0', id: request.id, result: await server.handle(request) });
      } catch (error) {
        const detail = error instanceof Error ? error : new Error(String(error));
        send({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: detail.message } });
      }
    }
  };
  await new Promise<void>((resolve) => process.stdin.once('end', resolve));
  await mink.dispose();
}
function send(value: unknown): void {
  const body = JSON.stringify(value);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
