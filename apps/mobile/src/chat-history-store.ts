import { create } from "zustand";
import type { PlannerResultLike } from "./search-presenter";

export interface ChatHistoryItem {
  id: string;
  owner: string;
  question: string;
  result: PlannerResultLike;
  createdAt: string;
}
// Session-only history. Never persist account tokens or conversation content.
export const useChatHistory = create<{
  items: ChatHistoryItem[];
  add: (owner: string, question: string, result: PlannerResultLike) => void;
}>((set) => ({
  items: [],
  add: (owner, question, result) =>
    set((state) => ({
      items: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          owner,
          question,
          result,
          createdAt: new Date().toISOString(),
        },
        ...state.items,
      ].slice(0, 30),
    })),
}));
