import { z } from 'zod';

export const MEMORY_TYPES = ['PROFILE', 'PREFERENCE', 'ASSET', 'PERSON', 'LOCATION', 'EVENT', 'DECISION', 'HISTORY'] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

export interface PersonalMemory {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  sourceKind: 'USER_INPUT' | 'CONVERSATION_CONFIRMED';
  sourceRef?: { conversationId: string; messageId: string; candidateId: string; modelId: string } | null;
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
  relations?: MemoryRelation[];
}
export const MEMORY_RELATIONS = ['OWNS', 'USES', 'PREFERS', 'RELATED_TO'] as const;
export type MemoryRelationType = typeof MEMORY_RELATIONS[number];
export interface MemoryRelation {
  id: string; version: number; fromId: string; fromVersion: number; toId: string; toVersion: number;
  relation: MemoryRelationType; weight: number; fromTitle: string; toTitle: string; createdAt: string;
}

/** Extraction is a suggestion. quote must be an exact substring of the current user intent. */
export const memorySuggestionSchema = z.object({ type: z.enum(MEMORY_TYPES), title: z.string().trim().min(1).max(120), quote: z.string().trim().min(2).max(1000) }).strict();
export type MemorySuggestion = z.infer<typeof memorySuggestionSchema>;
export interface MemoryCandidate {
  id: string; version: number; status: 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'UNAVAILABLE';
  conversationId: string; sourceMessageId: string; proposalMessageId: string;
  type: MemoryType; title: string | null; quote: string | null; modelId: string; createdAt: string;
  memoryId: string | null; confirmedMemoryVersion: number | null;
}
export interface MemoryReference {
  id: string; requestedVersion: number;
  state: 'CURRENT' | 'CHANGED' | 'DELETED' | 'EXPIRED' | 'DISABLED';
  memory: PersonalMemory | null;
  source: { kind: 'USER_INPUT' | 'CONVERSATION_CONFIRMED'; available: boolean; conversationId?: string; messageId?: string; content?: string };
}

export function groundedMemorySuggestions(intent: string, raw: unknown): MemorySuggestion[] {
  const parsed = z.array(memorySuggestionSchema).max(3).safeParse(raw);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  return parsed.data.filter(item => {
    const identity = `${item.type}:${item.quote}`;
    if (!intent.includes(item.quote) || seen.has(identity)) return false;
    seen.add(identity); return true;
  });
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
