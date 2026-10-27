import type { Command } from './types/schema.js';
import type { ParameterValue } from './commands/resolve.js';

export interface DiscoveryProvider {
  name: string;
  discover(directory: string): Promise<Record<string, Command>>;
}
export interface ParameterSource {
  name: string;
  values(specification: string, directory: string): Promise<string[]>;
}
export interface Runner {
  name: string;
  wrap(
    executable: string,
    args: string[],
    options?: Record<string, string>,
  ): { executable: string; args: string[] };
}
export interface SecretProvider {
  name: string;
  resolve(reference: string): Promise<string>;
}
export interface Notifier {
  name: string;
  notify(event: { id: string; state: string; durationMs: number }): Promise<void>;
}
export interface MinkPlugin {
  name: string;
  discovery?: DiscoveryProvider[];
  parameters?: ParameterSource[];
  runners?: Runner[];
  secrets?: SecretProvider[];
  notifiers?: Notifier[];
}
export interface PluginRegistry {
  discovery: Map<string, DiscoveryProvider>;
  parameters: Map<string, ParameterSource>;
  runners: Map<string, Runner>;
  secrets: Map<string, SecretProvider>;
  notifiers: Map<string, Notifier>;
}

export function defineConfig<T>(configuration: T): T {
  return configuration;
}
export function createPluginRegistry(): PluginRegistry {
  return {
    discovery: new Map(),
    parameters: new Map(),
    runners: new Map(),
    secrets: new Map(),
    notifiers: new Map(),
  };
}
export async function loadPlugins(
  names: string[],
  trusted: ReadonlySet<string>,
): Promise<PluginRegistry> {
  const registry = createPluginRegistry();
  for (const name of names) {
    if (!trusted.has(name)) throw new Error(`Plugin is not trusted: ${name}`);
    const imported = (await import(name)) as { default?: MinkPlugin; plugin?: MinkPlugin };
    const plugin = imported.default ?? imported.plugin;
    if (!plugin || plugin.name !== name) throw new Error(`Invalid Mink plugin: ${name}`);
    register(registry, plugin);
  }
  return registry;
}
function register(registry: PluginRegistry, plugin: MinkPlugin): void {
  for (const [key, providers] of Object.entries({
    discovery: plugin.discovery,
    parameters: plugin.parameters,
    runners: plugin.runners,
    secrets: plugin.secrets,
    notifiers: plugin.notifiers,
  }) as Array<[keyof PluginRegistry, Array<{ name: string }> | undefined]>)
    for (const provider of providers ?? []) {
      const map = registry[key] as Map<string, { name: string }>;
      if (map.has(provider.name)) throw new Error(`Duplicate plugin provider: ${provider.name}`);
      map.set(provider.name, provider);
    }
}

export type PluginParameterValue = ParameterValue;
