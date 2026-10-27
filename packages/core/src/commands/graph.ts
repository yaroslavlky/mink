import type { MinkConfiguration } from '../types/schema.js';

export interface CommandGraph {
  nodes: Array<{
    id: string;
    kind: 'command' | 'pipeline';
    name: string;
    tags: string[];
    group?: string;
  }>;
  edges: Array<{ from: string; to: string; type: 'depends_on' | 'uses' }>;
}

export function createCommandGraph(config: MinkConfiguration): CommandGraph {
  const edges: CommandGraph['edges'] = [];
  for (const [id, entry] of Object.entries(config.commands)) {
    if (entry.kind === 'command')
      for (const dependency of entry.depends_on ?? [])
        edges.push({
          from: id,
          to: typeof dependency === 'string' ? dependency : dependency.id,
          type: 'depends_on',
        });
    else
      for (const step of Object.values(entry.steps))
        edges.push({ from: id, to: step.uses, type: 'uses' });
  }
  return {
    nodes: Object.entries(config.commands).map(([id, entry]) => ({
      id,
      kind: entry.kind,
      name: entry.name,
      tags: entry.tags ?? [],
      ...(entry.group ? { group: entry.group } : {}),
    })),
    edges,
  };
}

export function graphDot(graph: CommandGraph): string {
  const quote = (value: string) => JSON.stringify(value);
  return [
    'digraph mink {',
    ...graph.nodes.map((node) => `  ${quote(node.id)} [label=${quote(node.name)}];`),
    ...graph.edges.map((edge) => `  ${quote(edge.from)} -> ${quote(edge.to)};`),
    '}',
  ].join('\n');
}

export function graphMermaid(graph: CommandGraph): string {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  return [
    'flowchart TD',
    ...graph.nodes.map((node) => `  ${ids.get(node.id)}[${JSON.stringify(node.name)}]`),
    ...graph.edges.map((edge) => `  ${ids.get(edge.from)} --> ${ids.get(edge.to)}`),
  ].join('\n');
}

export function graphText(graph: CommandGraph): string {
  return graph.nodes
    .map((node) => {
      const outgoing = graph.edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
      return `${node.id}${outgoing.length ? ` -> ${outgoing.join(', ')}` : ''}`;
    })
    .join('\n');
}
