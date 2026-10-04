import { create } from 'zustand';
import { api } from './api';
import { useAuthStore } from './auth-store';
export interface ExternalService { id: string; name: string; description: string; url: string; category: string; color: string; packageName?: string; importMethod?: 'SHARE' | 'MANUAL' }
interface Reference { id: string; title: string; summary: string; sourceUrl: string; category: string }
export const SERVICE_RECOMMENDATIONS: ExternalService[] = [];
function project(item: Reference): ExternalService { return { id: item.id, name: item.title, description: item.summary, url: item.sourceUrl, category: item.category, color: '#6F74E8' }; }
export const useExternalServices = create<{ items: ExternalService[]; hydrate: () => Promise<void>; add: (item: ExternalService) => Promise<void>; remove: (id: string) => Promise<void> }>((set, get) => ({
 items: [],
 hydrate: async () => { const token = useAuthStore.getState().token; set({ items: [] }); if (token) { const rows = await api<Reference[]>('/external-services', token); if (useAuthStore.getState().token === token) set({ items: rows.map(project) }); } },
 add: async item => { if (item.packageName) throw new Error('请从应用分享具体服务链接，不能将整个应用添加为服务'); const token = useAuthStore.getState().token; const url = new URL(item.url); const created = await api<Reference>('/external-services', token, { method: 'POST', body: JSON.stringify({ title: item.name, summary: item.description, sourceUrl: url.href, sourcePlatform: url.hostname, category: item.category, importMethod: item.importMethod ?? 'MANUAL' }) }); if (useAuthStore.getState().token === token) set({ items: [...get().items, project(created)] }); },
 remove: async id => { await api(`/external-services/${id}`, useAuthStore.getState().token, { method: 'DELETE' }); set({ items: get().items.filter(item => item.id !== id) }); },
}));

useAuthStore.subscribe((state, previous) => { if (state.token !== previous.token) useExternalServices.setState({ items: [] }); });
