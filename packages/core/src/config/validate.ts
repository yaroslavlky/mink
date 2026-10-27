import type { MinkConfiguration } from '../types/schema.js';
import { assertParameterValue } from '../commands/resolve.js';
export function validateReferences(config: MinkConfiguration): void {
  const entries = config.commands,
    exists = (id: string) => Object.hasOwn(entries, id);
  for (const [id, entry] of Object.entries(entries)) {
    for (const [name, p] of Object.entries(entry.params ?? {})) {
      if (p.default !== undefined)
        assertParameterValue(`${id}.params.${name}.default`, p, p.default);
      if (p.env && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.env))
        throw new Error(`${id}.${name}: invalid env name`);
      if (p.when) {
        const target = entry.params?.[p.when.param];
        if (!target || !Object.hasOwn(entry.params ?? {}, p.when.param))
          throw new Error(`${id}.${name}: unknown condition parameter ${p.when.param}`);
        assertParameterValue(`${id}.${name}.when`, target, p.when.equals);
      }
      if (p.regex !== undefined) {
        try {
          new RegExp(p.regex);
        } catch {
          throw new Error(`${id}.${name}: invalid regex`);
        }
      }
      if (p.min !== undefined && p.max !== undefined && p.min > p.max)
        throw new Error(`${id}.${name}: min exceeds max`);
      for (const required of p.requires ?? [])
        if (!Object.hasOwn(entry.params ?? {}, required))
          throw new Error(`${id}.${name}: unknown required parameter ${required}`);
      if (p.positional && (p.env || p.flag))
        throw new Error(`${id}.${name}: positional parameters cannot use env or flag`);
      if (p.variadic && !p.positional)
        throw new Error(`${id}.${name}: variadic requires positional`);
    }
    checkCycles(
      Object.keys(entry.params ?? {}),
      (name) => {
        const c = entry.params?.[name].when;
        return c ? [c.param] : [];
      },
      `${id}.params`,
    );
    for (const [preset, values] of Object.entries(entry.presets ?? {}))
      for (const [name, value] of Object.entries(values)) {
        const p = entry.params?.[name];
        if (!p || !Object.hasOwn(entry.params ?? {}, name))
          throw new Error(`${id}.presets.${preset}: unknown parameter ${name}`);
        if (p.type === 'secret')
          throw new Error(`${id}.presets.${preset}: secret values cannot be saved`);
        assertParameterValue(`${id}.presets.${preset}.${name}`, p, value);
      }
    if (entry.kind === 'command') {
      if (entry.exec && entry.shell) throw new Error(`${id}: exec does not use a shell`);
      if ([entry.command, entry.exec, ...(entry.args ?? [])].some((value) => value?.includes('\0')))
        throw new Error(`${id}: command and arguments cannot contain NUL`);
      for (const configured of entry.depends_on ?? []) {
        const dependency = typeof configured === 'string' ? { id: configured } : configured;
        const dep = dependency.id;
        if (
          !exists(dep) ||
          entries[dep].kind !== 'command' ||
          (entries[dep].run?.mode === 'service' &&
            !['started', 'healthy'].includes(dependency.condition ?? ''))
        )
          throw new Error(
            `${id}: dependency ${dep} must be a one-shot command; use pipeline needs for services`,
          );
      }
      const run = entry.run;
      if (run?.mode !== 'service' && (run?.startup_timeout_ms || run?.ready))
        throw new Error(`${id}: startup settings require service mode`);
      if (run?.mode === 'service' && run.timeout_ms)
        throw new Error(`${id}: service requires startup_timeout_ms, not timeout_ms`);
      if (run?.ready?.type === 'http') new URL(run.ready.url!);
      if (run?.health?.type === 'http') new URL(run.health.url!);
      if (run?.mode !== 'service' && (run?.health || run?.restart))
        throw new Error(`${id}: health and restart require service mode`);
      if (run?.mode === 'service' && run.retry)
        throw new Error(`${id}: use restart for services, retry for tasks`);
      for (const name of entry.requires ?? [])
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
          throw new Error(`${id}: invalid required environment variable ${name}`);
    } else {
      for (const [kind, configured] of Object.entries(entry.hooks ?? {}))
        for (const hook of Array.isArray(configured) ? configured : [configured])
          if (!exists(hook)) throw new Error(`${id}.hooks.${kind}: unknown command ${hook}`);
      for (const [stepId, step] of Object.entries(entry.steps)) {
        if (!exists(step.uses)) throw new Error(`${id}.${stepId}: unknown command ${step.uses}`);
        for (const need of step.needs ?? [])
          if (!Object.hasOwn(entry.steps, need))
            throw new Error(`${id}.${stepId}: unknown step ${need}`);
        for (const wait of step.wait_for ?? [])
          if (!Object.hasOwn(entry.steps, wait))
            throw new Error(`${id}.${stepId}: unknown wait_for step ${wait}`);
        for (const [name, value] of Object.entries(step.with ?? {})) {
          const target = entries[step.uses].params?.[name];
          if (!target || !Object.hasOwn(entries[step.uses].params ?? {}, name))
            throw new Error(`${id}.${stepId}: unknown target parameter ${name}`);
          const matrix = typeof value === 'string' && /^\$\{matrix\.([^}]+)\}$/.exec(value);
          if (matrix) {
            const configured =
              step.matrix?.[matrix[1]] ??
              (step.for?.var === matrix[1] ? step.for.values : undefined);
            if (!configured) throw new Error(`${id}.${stepId}: unknown matrix value ${matrix[1]}`);
            continue;
          }
          const match = typeof value === 'string' && /^\$\{params\.([^}]+)\}$/.exec(value);
          if (match) {
            const source = entry.params?.[match[1]];
            if (!source || !Object.hasOwn(entry.params ?? {}, match[1]))
              throw new Error(`${id}.${stepId}: unknown pipeline parameter ${match[1]}`);
            if (source.type === 'secret' && target.type !== 'secret')
              throw new Error(
                `${id}.${stepId}: secrets can only be forwarded to secret parameters`,
              );
            const primitive = (type: string) =>
              ['number', 'port'].includes(type)
                ? 'number'
                : type === 'boolean'
                  ? 'boolean'
                  : 'string';
            if (primitive(source.type) !== primitive(target.type))
              throw new Error(`${id}.${stepId}.${name}: parameter type mismatch`);
          } else assertParameterValue(`${id}.${stepId}.${name}`, target, value);
        }
      }
      checkCycles(Object.keys(entry.steps), (step) => entry.steps[step].needs ?? [], `${id}.steps`);
    }
  }
  const names = new Set(Object.keys(entries));
  for (const [id, entry] of Object.entries(entries))
    for (const alias of entry.aliases ?? []) {
      if (names.has(alias)) throw new Error(`${id}: alias conflicts with command ${alias}`);
      names.add(alias);
    }
  checkCycles(
    Object.keys(entries),
    (id) => {
      const e = entries[id];
      return e.kind === 'command'
        ? (e.depends_on ?? []).map((dependency) =>
            typeof dependency === 'string' ? dependency : dependency.id,
          )
        : [
            ...Object.values(e.steps).map((s) => s.uses),
            ...Object.values(e.hooks ?? {}).flatMap((value) =>
              Array.isArray(value) ? value : [value],
            ),
          ];
    },
    'commands',
  );
}
function checkCycles(nodes: string[], edges: (id: string) => string[], path: string): void {
  const active = new Set<string>(),
    done = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) throw new Error(`${path}: cycle at ${id}`);
    if (done.has(id)) return;
    active.add(id);
    for (const n of edges(id)) visit(n);
    active.delete(id);
    done.add(id);
  }
  for (const id of nodes) visit(id);
}
