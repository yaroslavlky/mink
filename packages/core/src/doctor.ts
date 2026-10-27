import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { loadConfig } from './config/load.js';
import { SettingsStore } from './storage.js';
import type { MinkOptions } from './index.js';

export interface DoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  hint?: string;
}
export interface DoctorReport {
  platform: string;
  arch: string;
  node: string;
  ok: boolean;
  checks: DoctorCheck[];
}

export async function findExecutable(
  file: string,
  cwd = process.cwd(),
): Promise<string | undefined> {
  const extensions =
    process.platform === 'win32'
      ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')]
      : [''];
  const directories =
    isAbsolute(file) || file.includes('/') || file.includes('\\')
      ? ['']
      : (process.env.PATH ?? '').split(delimiter);
  for (const directory of directories)
    for (const extension of extensions) {
      const path = resolve(cwd, directory, file + extension);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return path;
      } catch {
        /* Try the next PATH entry. */
      }
    }
}

async function portBusy(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (busy: boolean) => {
      socket.destroy();
      resolve(busy);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

/** Inspects configuration and PATH; never executes project commands or creates state. */
export async function doctor(options: MinkOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);
  add({
    id: 'node',
    status: Number(process.versions.node.split('.')[0]) >= 24 ? 'pass' : 'fail',
    message: `Node.js ${process.versions.node}`,
    hint: 'Mink requires Node.js 24 or newer.',
  });
  add({
    id: 'platform',
    status: ['linux', 'darwin', 'win32'].includes(process.platform) ? 'pass' : 'warn',
    message: `${process.platform}/${process.arch}`,
  });
  const tools = new Map<string, string>();
  if (process.platform === 'win32') tools.set('powershell.exe', 'Windows process supervisor');
  let loaded: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    loaded = await loadConfig(options.configFile, options.cwd, options.discover ?? true);
    add({
      id: 'config',
      status: 'pass',
      message: `Valid configuration: ${Object.keys(loaded.config.commands).length} entries`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    add({
      id: 'config',
      status: message.startsWith('No mink.yml') && !options.configFile ? 'warn' : 'fail',
      message,
      hint: 'Run mink init or specify --config.',
    });
  }
  if (loaded)
    for (const [id, entry] of Object.entries(loaded.config.commands)) {
      if (entry.kind !== 'command') continue;
      const cwd = resolve(loaded.directory, entry.cwd ?? '.');
      if (entry.exec)
        tools.set(
          entry.exec.includes('/') || entry.exec.includes('\\')
            ? resolve(cwd, entry.exec)
            : entry.exec,
          `command ${id}`,
        );
      else {
        const shell =
          entry.shell === 'auto' || !entry.shell
            ? process.platform === 'win32'
              ? 'powershell'
              : 'sh'
            : entry.shell;
        tools.set(
          shell === 'powershell'
            ? 'powershell.exe'
            : shell === 'sh' && process.platform !== 'win32'
              ? '/bin/sh'
              : shell,
          `shell for ${id}`,
        );
      }
      for (const [tool, version] of Object.entries(entry.requires_tools ?? {}))
        tools.set(tool, `command ${id} requires ${version}`);
      try {
        if (!(await stat(cwd)).isDirectory()) throw new Error();
      } catch {
        add({
          id: `cwd:${id}`,
          status: 'fail',
          message: `Working directory does not exist: ${cwd}`,
        });
      }
      const ready = entry.run?.health ?? entry.run?.ready;
      if (!ready || ready.type === 'process') continue;
      const url = ready.type === 'http' ? new URL(ready.url!) : undefined;
      const host = url?.hostname ?? ready.host ?? '127.0.0.1';
      const port = url ? Number(url.port || (url.protocol === 'https:' ? 443 : 80)) : ready.port!;
      if (
        ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host) &&
        (await portBusy(host.replaceAll('[', '').replaceAll(']', ''), port))
      )
        add({
          id: `port:${id}`,
          status: 'warn',
          message: `${id}: local port ${port} is already accepting connections`,
          hint: 'An existing service may be using this port.',
        });
    }
  for (const [file, reason] of tools) {
    const found = await findExecutable(file, loaded?.directory ?? options.cwd);
    add({
      id: `tool:${file}`,
      status: found ? 'pass' : 'fail',
      message: `${file}: ${found ?? 'not found'} (${reason})`,
      ...(found ? {} : { hint: 'Install the tool and add it to PATH.' }),
    });
  }
  let state = dirname(new SettingsStore(options.stateDirectory).file);
  try {
    while (true) {
      try {
        await stat(state);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(state) === state)
          throw error;
        state = dirname(state);
      }
    }
    await access(state, constants.W_OK);
    add({ id: 'storage', status: 'pass', message: 'Local state directory is writable' });
  } catch {
    add({
      id: 'storage',
      status: 'fail',
      message: 'Local state directory is not writable',
      hint: 'Check your user profile permissions or XDG_STATE_HOME.',
    });
  }
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    ok: !checks.some((check) => check.status === 'fail'),
    checks,
  };
}
