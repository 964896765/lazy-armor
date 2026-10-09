export const MEMORY_TYPES = ['PROFILE', 'PREFERENCE', 'ASSET', 'PERSON', 'LOCATION', 'EVENT', 'DECISION', 'HISTORY'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

export interface PersonalMemory {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  sourceKind: 'USER_INPUT';
  version: number;
  confirmedAt: string;
  createdAt: string;
  expiresAt: string | null;
}
export interface MemorySettings { enabled: boolean; version: number }
export interface MemoryContextSnapshot {
  enabled: boolean;
  settingsVersion: number;
  items: PersonalMemory[];
}

/** Bounded relevance ranking over owned, enabled, unexpired, confirmed memories only. */
export function rankPersonalMemories(intent: string, memories: readonly PersonalMemory[], now = Date.now(), limit = 8): PersonalMemory[] {
  const tokens = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(intent.toLowerCase())]
    .filter(part => part.isWordLike && part.segment.length > 1).map(part => part.segment).slice(0, 64);
  return memories.filter(memory => !memory.expiresAt || Date.parse(memory.expiresAt) > now).map(memory => {
    const text = `${memory.title} ${memory.content}`.toLowerCase();
    const relevance = tokens.filter(token => text.includes(token)).length;
    const score = relevance * 10 + (['PROFILE', 'PREFERENCE'].includes(memory.type) ? 1 : 0);
    return { memory, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.memory.confirmedAt.localeCompare(a.memory.confirmedAt) || a.memory.id.localeCompare(b.memory.id))
    .slice(0, limit).map(item => item.memory);
}
