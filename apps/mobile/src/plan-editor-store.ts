import { create } from 'zustand';
export interface PlanStep { id: string; name: string; description: string; resources: string[]; completion: string }
interface Draft { name: string; summary: string; goal: string; steps: PlanStep[]; time: string; frequency: string; confirm: boolean; update: (patch: Partial<Omit<Draft, 'update' | 'reset'>>) => void; reset: () => void }
const initial = { name: '', summary: '', goal: '', steps: [] as PlanStep[], time: '07:30', frequency: '每天', confirm: true };
export const usePlanDraft = create<Draft>((set) => ({ ...initial, update: (patch) => set(patch), reset: () => set({ ...initial, steps: [] }) }));
export function newStep(): PlanStep { return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: '', description: '', resources: [], completion: '' }; }
