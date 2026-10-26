import { createConsola, type ConsolaInstance } from 'consola';
import { loadConfig } from './config/load.js';
import {
  assertParameterValue,
  prepareEntry,
  resolveValues,
  type ParameterValue,
  type PreparedCommand,
} from './commands/resolve.js';
import { createCommandSearch, type CommandSearchResult } from './commands/search.js';
import {
  planExecution,
  planFailedBranches,
  mergeRetryResult,
  type ExecutionPlan,
} from './commands/plan.js';
import { Session } from './runtime/session.js';
import type { RunEvent, RunOptions, RunResult, ServiceInfo } from './runtime/process.js';
import {
  SettingsStore,
  StateStore,
  TrustStore,
  GlobalConfigStore,
  stateRoot,
  languages,
  themes,
  type LocalState,
  type Settings,
} from './storage.js';
import { CacheStore, type CacheInfo, type CacheStatus } from './runtime/cache.js';
import type { MinkConfiguration } from './types/schema.js';
import { createCommandGraph, type CommandGraph } from './commands/graph.js';
import { resolveDynamicOptions } from './commands/options.js';
export interface Mink {
  readonly configFile: string;
  readonly directory: string;
  readonly logger: ConsolaInstance;
  getConfig(): MinkConfiguration;
  searchCommands(query: string, limit?: number): CommandSearchResult[];
  prepare(id: string, values?: Record<string, ParameterValue>): PreparedCommand;
  plan(id: string, values?: Record<string, ParameterValue>): ExecutionPlan;
  run(
    id: string,
    values?: Record<string, ParameterValue>,
    options?: RunOptions,
  ): Promise<RunResult>;
  subscribe(listener: (event: RunEvent) => void): () => void;
  services(): ServiceInfo[];
  stopService(instance: string, force?: boolean): Promise<void>;
  restartService(instance: string): Promise<RunResult>;
  scaleService(id: string, count: number): Promise<ServiceInfo[]>;
  state(): Promise<LocalState>;
  settings(): Promise<Settings>;
  updateSettings(change: Partial<Settings>): Promise<Settings>;
  favorite(id: string): Promise<void>;
  savePreset(id: string, name: string, values: Record<string, ParameterValue>): Promise<void>;
  preset(id: string, name: string): Promise<Record<string, ParameterValue>>;
  dispose(): Promise<void>;
  cacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<void>;
  pruneCache(): Promise<CacheInfo>;
  why(id: string, values?: Record<string, ParameterValue>): Promise<CacheStatus[]>;
  environment(id: string, values?: Record<string, ParameterValue>): Record<string, string>;
  select(selector?: string, tag?: string, group?: string): string[];
  graph(): CommandGraph;
  options(id: string, parameter: string): Promise<string[]>;
  trust(): Promise<import('./storage.js').TrustStatus>;
  untrust(): Promise<void>;
  trustStatus(): Promise<import('./storage.js').TrustStatus>;
}
export interface MinkOptions {
  configFile?: string;
  cwd?: string;
  logger?: ConsolaInstance;
  discover?: boolean;
  stateDirectory?: string;
  profile?: string;
}
export async function createMink(options: MinkOptions = {}): Promise<Mink> {
  const logger = options.logger ?? createConsola().withTag('mink');
  const globalConfig = await new GlobalConfigStore().read();
  const loaded = await loadConfig(
    options.configFile,
    options.cwd,
    options.discover ?? true,
    options.profile ?? globalConfig.defaultProfile,
  );
  const session = new Session(),
    store = new StateStore(loaded.file, options.stateDirectory),
    settingsStore = new SettingsStore(options.stateDirectory),
    cache = new CacheStore(loaded.directory, stateRoot(options.stateDirectory), {
      ttl_ms: loaded.config.cache?.ttl_ms ?? globalConfig.cacheTtlMs,
      max_size_bytes: loaded.config.cache?.max_size_bytes ?? globalConfig.cacheMaxSizeBytes,
    }),
    trust = new TrustStore(loaded.file, options.stateDirectory);
  const aliases = new Map<string, string>();
  for (const [id, entry] of Object.entries(loaded.config.commands))
    for (const alias of entry.aliases ?? []) aliases.set(alias, id);
  const canonical = (id: string) => aliases.get(id) ?? id;
  const getEntry = (requested: string) => {
    const id = canonical(requested);
    if (!Object.hasOwn(loaded.config.commands, id))
      throw new Error(`Unknown command: ${requested}`);
    return loaded.config.commands[id];
  };
  const makePlan = (id: string, values: Record<string, ParameterValue> = {}) =>
    planExecution(
      loaded.config,
      loaded.directory,
      canonical(id),
      values,
      loaded.environment,
      loaded.hiddenEnvironment,
    );
  const pendingRuns = new Set<Promise<RunResult>>();
  return {
    configFile: loaded.file,
    directory: loaded.directory,
    logger,
    getConfig: () => structuredClone(loaded.config),
    searchCommands: createCommandSearch(loaded.config),
    prepare: (id, values = {}) => {
      const entry = getEntry(id);
      if (entry.kind !== 'command') throw new Error(`${id} is a pipeline; use plan()`);
      return prepareEntry(entry, resolveValues(entry, values, id), loaded.directory);
    },
    plan: makePlan,
    run(id, values = {}, runOptions = {}) {
      const pending = (async () => {
        if (!loaded.discovered) await trust.assertTrusted();
        const fullPlan = makePlan(id, values);
        const plan = runOptions.retryFailed
          ? planFailedBranches(fullPlan, runOptions.retryFailed)
          : fullPlan;
        const needsApproval = (node: ExecutionPlan): boolean =>
          !!(node.entry?.confirm || node.entry?.prompt) ||
          node.dependencies.some(needsApproval) ||
          Object.values(node.steps).some((step) => needsApproval(step.plan));
        if (needsApproval(plan) && !runOptions.approved)
          throw new Error('Command requires explicit approval');
        if (runOptions.args?.length) {
          if (!plan.prepared)
            throw new Error('Passthrough arguments require a command, not a pipeline');
          plan.prepared.args.push(...runOptions.args);
        }
        const replicas = plan.entry?.run?.mode === 'service' ? (plan.entry.run.replicas ?? 1) : 1;
        let executed = await session.run(plan, { ...runOptions, cache });
        for (let replica = 1; replica < replicas; replica++)
          executed = await session.run(structuredClone(plan), { ...runOptions, cache });
        const result = runOptions.retryFailed
          ? mergeRetryResult(runOptions.retryFailed, executed)
          : executed;
        try {
          await store.update((state) => {
            state.history.unshift({
              id,
              time: new Date().toISOString(),
              state: result.state,
              durationMs: result.durationMs,
            });
            state.history = state.history.slice(0, 100);
          });
        } catch (error) {
          logger.warn('Could not save history', error);
        }
        return result;
      })();
      pendingRuns.add(pending);
      void pending.then(
        () => pendingRuns.delete(pending),
        () => pendingRuns.delete(pending),
      );
      return pending;
    },
    subscribe: (listener) => session.subscribe(listener),
    cacheInfo: () => cache.list(),
    clearCache: () => cache.clear(),
    pruneCache: () => cache.prune(),
    async why(id, values = {}) {
      const plan = makePlan(id, values);
      const leaves: ExecutionPlan[] = [];
      const collect = (node: ExecutionPlan) => {
        if (node.entry) leaves.push(node);
        for (const dependency of node.dependencies) collect(dependency);
        for (const step of Object.values(node.steps)) collect(step.plan);
      };
      collect(plan);
      return Promise.all(leaves.map((leaf) => cache.lookup(leaf)));
    },
    environment(id, values = {}) {
      const plan = makePlan(id, values);
      if (!plan.prepared) throw new Error(`${id} is a pipeline; inspect its plan instead`);
      const hidden = new Set(plan.prepared.hiddenEnv);
      return Object.fromEntries(
        Object.entries(plan.prepared.env).map(([name, value]) => [
          name,
          hidden.has(name) ? '[hidden]' : value,
        ]),
      );
    },
    select(selector = '*', tag, group) {
      const pattern = new RegExp(
        `^${selector
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      return Object.entries(loaded.config.commands)
        .filter(
          ([id, entry]) =>
            pattern.test(id) &&
            !entry.hidden &&
            !entry.private &&
            !entry.internal &&
            (!tag || entry.tags?.includes(tag)) &&
            (!group || entry.group === group),
        )
        .map(([id]) => id);
    },
    graph: () => createCommandGraph(loaded.config),
    async options(id, parameter) {
      if (!loaded.discovered) await trust.assertTrusted();
      const entry = getEntry(id);
      const definition = entry.params?.[parameter];
      if (!definition) throw new Error(`${id}: unknown parameter ${parameter}`);
      if (definition.options) return [...definition.options];
      if (!definition.options_from) throw new Error(`${id}.${parameter}: no dynamic options`);
      return resolveDynamicOptions(
        definition.options_from.exec,
        loaded.directory,
        loaded.environment,
      );
    },
    trust: () => trust.trust(),
    untrust: () => trust.untrust(),
    trustStatus: () => trust.status(),
    services: () =>
      session
        .services()
        .map(({ instance, id, state, started, url, completion, restarts, healthHistory }) => ({
          instance,
          id,
          state,
          started,
          url,
          completion,
          restarts,
          healthHistory: structuredClone(healthHistory),
        })),
    stopService: (id, force) => session.stop(id, force),
    restartService: (id) => session.restart(id),
    async scaleService(id, count) {
      if (!Number.isInteger(count) || count < 0 || count > 128)
        throw new Error('Replica count must be an integer from 0 to 128');
      const active = session.services().filter((service) => service.id === id);
      for (const service of active.slice(count)) await session.stop(service.instance);
      for (let replica = active.length; replica < count; replica++) {
        const plan = makePlan(id);
        if (plan.entry?.run?.mode !== 'service') throw new Error(`${id} is not a service`);
        plan.entry.run.replicas = count;
        await session.run(plan, { cache });
      }
      return session
        .services()
        .filter((service) => service.id === id)
        .map(({ instance, id, state, started, url, completion, restarts, healthHistory }) => ({
          instance,
          id,
          state,
          started,
          url,
          completion,
          restarts,
          healthHistory: structuredClone(healthHistory),
        }));
    },
    async dispose() {
      await session.dispose();
      await Promise.allSettled([...pendingRuns]);
    },
    state: () => store.read(),
    settings: () => settingsStore.read(),
    async updateSettings(change) {
      if (change.theme !== undefined && !themes.includes(change.theme))
        throw new Error(`Unknown theme: ${change.theme}`);
      if (change.language !== undefined && !languages.includes(change.language))
        throw new Error(`Unknown language: ${change.language}`);
      return settingsStore.update((settings) => {
        if (change.theme !== undefined) settings.theme = change.theme;
        if (change.language !== undefined) settings.language = change.language;
      });
    },
    async favorite(id) {
      getEntry(id);
      await store.update((state) => {
        state.favorites = state.favorites.includes(id)
          ? state.favorites.filter((v) => v !== id)
          : [...state.favorites, id];
      });
    },
    async savePreset(id, name, values) {
      const entry = getEntry(id);
      if (!name.trim()) throw new Error('Preset name is required');
      const snapshot = structuredClone(values);
      for (const [key, value] of Object.entries(snapshot)) {
        if (!Object.hasOwn(entry.params ?? {}, key))
          throw new Error(`${id}: unknown parameter ${key}`);
        const p = entry.params![key];
        if (p.type === 'secret') throw new Error('Secret parameters cannot be saved in presets');
        assertParameterValue(`${id}.${key}`, p, value);
      }
      await store.update((state) => {
        if (
          Object.hasOwn(state.presets[id] ?? {}, name) ||
          Object.hasOwn(entry.presets ?? {}, name)
        )
          throw new Error('Preset exists; choose a new name');
        if (!Object.hasOwn(state.presets, id))
          Object.defineProperty(state.presets, id, {
            value: {},
            enumerable: true,
            writable: true,
            configurable: true,
          });
        Object.defineProperty(state.presets[id], name, {
          value: snapshot,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      });
    },
    async preset(id, name) {
      const entry = getEntry(id),
        state = await store.read();
      const local =
        Object.hasOwn(state.presets, id) && Object.hasOwn(state.presets[id], name)
          ? state.presets[id][name]
          : undefined;
      const repo =
        entry.presets && Object.hasOwn(entry.presets, name) ? entry.presets[name] : undefined;
      const values = local ?? repo;
      if (!values) throw new Error(`Unknown preset ${id}@${name}`);
      for (const key of Object.keys(values)) {
        if (!entry.params?.[key]) throw new Error(`Stale preset: unknown parameter ${key}`);
        if (entry.params[key].type === 'secret')
          throw new Error('Secret values in preset are forbidden');
      }
      return structuredClone(values);
    },
  };
}
export { themes, languages, defaultSettings, detectLanguage } from './storage.js';
export type { Settings, ThemeName, Language } from './storage.js';
export type { TrustStatus } from './storage.js';
export { validateConfig } from './config/load.js';
export { initConfig } from './config/init.js';
export { doctor, findExecutable } from './doctor.js';
export type { DoctorCheck, DoctorReport } from './doctor.js';
export { describePlan, formatPlan } from './commands/describe.js';
export type { PlanDescription } from './commands/describe.js';
export { planFailedBranches } from './commands/plan.js';
export { watchTasks } from './runtime/watch.js';
export { CacheStore } from './runtime/cache.js';
export { HttpRemoteCache, S3CompatibleCache } from './runtime/remote-cache.js';
export type { RemoteCacheProvider, HttpCacheOptions } from './runtime/remote-cache.js';
export type { WatchOptions } from './runtime/watch.js';
export { createRunLog, redactSecrets } from './runtime/log.js';
export { createCommandGraph, graphDot, graphMermaid, graphText } from './commands/graph.js';
export type { CommandGraph } from './commands/graph.js';
export { formatConfig, lintConfig } from './config/tools.js';
export { resolveDynamicOptions } from './commands/options.js';
export { shellCompletion, shellInit } from './shell.js';
export type { ShellName } from './shell.js';
export { upgradeMink } from './upgrade.js';
export { GlobalConfigStore } from './storage.js';
export type { GlobalConfig } from './storage.js';
export { SupervisorServer, SupervisorClient, supervisorEndpoint } from './runtime/supervisor.js';
export type { SupervisorRequest, SupervisorResponse } from './runtime/supervisor.js';
export { workspaceGraph, affectedPackages, analyzePlan, pruneWorkspace } from './monorepo.js';
export type { WorkspacePackage } from './monorepo.js';
export {
  resolveValues,
  parseParameter,
  parameterFields,
  commandLine,
  shellQuote,
} from './commands/resolve.js';
export type { MinkConfiguration, Command, Pipeline, Parameter } from './types/schema.js';
export type {
  ParameterValue,
  PreparedCommand,
  CommandSearchResult,
  ExecutionPlan,
  RunEvent,
  RunOptions,
  RunResult,
  ServiceInfo,
  CacheInfo,
  CacheStatus,
  LocalState,
};
