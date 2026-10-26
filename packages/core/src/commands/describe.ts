import type { ExecutionPlan } from './plan.js';

export interface PlanDescription {
  id: string;
  key: string;
  kind: 'task' | 'service' | 'pipeline';
  command?: string;
  exec?: string;
  args?: string[];
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  maxParallel: number | null;
  failFast?: boolean;
  timeoutMs?: number;
  dependencies: PlanDescription[];
  steps: Record<string, { needs: string[]; plan: PlanDescription }>;
}

/** A public projection: never serialize raw plans, which contain secret env values. */
export function describePlan(root: ExecutionPlan): PlanDescription {
  const secrets = new Set<string>();
  const collect = (plan: ExecutionPlan) => {
    for (const p of Object.values(plan.entry?.params ?? {})) {
      const value = p.env && plan.prepared?.env[p.env];
      if (p.type === 'secret' && value) secrets.add(value);
    }
    plan.dependencies.forEach(collect);
    Object.values(plan.steps).forEach((step) => collect(step.plan));
  };
  collect(root);
  const values = [...secrets].sort((a, b) => b.length - a.length);
  const redact = (value: string) =>
    values.reduce((text, secret) => text.replaceAll(secret, '[hidden]'), value);
  const describe = (plan: ExecutionPlan): PlanDescription => {
    const p = plan.prepared;
    const secretEnvs = new Set(p?.hiddenEnv);
    return {
      id: plan.id,
      key: plan.key,
      kind: plan.entry ? (plan.entry.run?.mode === 'service' ? 'service' : 'task') : 'pipeline',
      ...(p
        ? {
            ...(p.executable ? { exec: redact(p.executable) } : { command: redact(p.command) }),
            args: p.args.map(redact),
            shell: p.executable ? 'none' : (p.shell ?? 'auto'),
            cwd: p.cwd && redact(p.cwd),
            env: Object.fromEntries(
              Object.entries(p.env).map(([key, value]) => [
                key,
                secretEnvs.has(key) ? '[hidden]' : redact(value),
              ]),
            ),
          }
        : {}),
      maxParallel: Number.isFinite(plan.maxParallel) ? plan.maxParallel : null,
      ...(plan.failFast !== undefined ? { failFast: plan.failFast } : {}),
      ...(plan.timeoutMs ? { timeoutMs: plan.timeoutMs } : {}),
      dependencies: plan.dependencies.map(describe),
      steps: Object.fromEntries(
        Object.entries(plan.steps).map(([name, step]) => [
          name,
          { needs: [...step.needs], plan: describe(step.plan) },
        ]),
      ),
    };
  };
  return describe(root);
}

export function formatPlan(plan: PlanDescription): string {
  const lines: string[] = [];
  const visit = (node: PlanDescription, depth: number, label = node.id) => {
    const prefix = '  '.repeat(depth);
    lines.push(
      `${prefix}${label} [${node.kind}]${node.maxParallel ? ` parallel=${node.maxParallel}` : ''}`,
    );
    if (node.cwd) lines.push(`${prefix}  cwd: ${node.cwd}`);
    if (node.exec)
      lines.push(`${prefix}  exec: ${JSON.stringify([node.exec, ...(node.args ?? [])])}`);
    else if (node.command)
      lines.push(
        `${prefix}  command (${node.shell}): ${node.command}${node.args?.length ? ` args=${JSON.stringify(node.args)}` : ''}`,
      );
    for (const [key, value] of Object.entries(node.env ?? {}))
      lines.push(`${prefix}  env ${key}=${JSON.stringify(value)}`);
    node.dependencies.forEach((dep) => visit(dep, depth + 1, `requires ${dep.id}`));
    for (const [name, step] of Object.entries(node.steps))
      visit(
        step.plan,
        depth + 1,
        `${name} → ${step.plan.id}${step.needs.length ? ` (needs: ${step.needs.join(', ')})` : ''}`,
      );
  };
  visit(plan, 0);
  return lines.join('\n');
}
