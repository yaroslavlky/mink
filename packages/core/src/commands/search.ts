import Fuse from 'fuse.js';
import type { Command, MinkConfiguration, Pipeline } from '../types/schema.js';

type CommandEntry = Command | Pipeline;

export interface CommandSearchResult {
  id: string;
  entry: CommandEntry;
  score: number;
}

interface SearchDocument {
  id: string;
  name: string;
  description: string;
  command: string;
  entry: CommandEntry;
}

export function createCommandSearch(config: MinkConfiguration) {
  const documents: SearchDocument[] = Object.entries(config.commands)
    .filter(([, entry]) => !entry.hidden && !entry.private && !entry.internal)
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      description: entry.description ?? '',
      command:
        entry.kind === 'command'
          ? (entry.command ?? [entry.exec, ...(entry.args ?? [])].join(' '))
          : '',
      entry,
    }));
  const fuse = new Fuse(documents, {
    useTokenSearch: true,
    tokenMatch: 'all',
    includeScore: true,
    keys: [
      { name: 'id', weight: 4 },
      { name: 'name', weight: 3 },
      { name: 'description', weight: 1 },
      { name: 'command', weight: 1 },
    ],
  });

  return (query: string, limit?: number): CommandSearchResult[] => {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new Error('Search limit must be a positive integer');
    }
    const results = query.trim()
      ? fuse.search(query, limit === undefined ? undefined : { limit }).map(({ item, score }) => ({
          id: item.id,
          entry: structuredClone(item.entry),
          score: score ?? 1,
        }))
      : documents.slice(0, limit).map((item) => ({
          id: item.id,
          entry: structuredClone(item.entry),
          score: 0,
        }));
    return results;
  };
}
