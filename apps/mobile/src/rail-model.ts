export interface RailProviderInput { id: string; key: string; label: string; status: string; pinned?: boolean; unread?: number; lastUsedAt?: string | null; useCount?: number }
export interface RailDeviceAppInput { id: string; packageName: string; label: string; enabled: boolean; trustedDeviceId: string | null; pinned?: boolean; unread?: number; lastUsedAt?: string | null; useCount?: number }
export interface RailTrustedDeviceInput { id: string; status: 'active' | 'revoked' }
export interface RailDiscoveredAppInput { packageName: string; iconDataUri?: string | null }
export interface ConnectionRailItem { id: string; key: string; label: string; status: 'healthy' | 'warning'; unread: number; kind: 'provider' | 'app' }

const ACTION_REQUIRED = new Set(['pending_authorization', 'reauthorization_required', 'provider_error', 'error', 'expired']);

export function buildConnectionRailModel(input: {
  providers: RailProviderInput[];
  deviceApps: RailDeviceAppInput[];
  trustedDevices: RailTrustedDeviceInput[];
  discoveredApps: RailDiscoveredAppInput[];
  maxVisible?: number;
}) {
  const trusted = new Map(input.trustedDevices.map((device) => [device.id, device.status]));
  const candidates: Array<ConnectionRailItem & { score: number; order: number }> = [];
  input.providers.forEach((provider, order) => {
    if (provider.status === 'revoked') return;
    const warning = ACTION_REQUIRED.has(provider.status);
    candidates.push({ id: provider.id, key: provider.key, label: provider.label, status: warning ? 'warning' : 'healthy', unread: provider.unread ?? 0, kind: 'provider', score: score(provider, warning), order });
  });
  input.deviceApps.forEach((app, order) => {
    if (!app.enabled || !app.trustedDeviceId || trusted.get(app.trustedDeviceId) !== 'active') return;
    candidates.push({ id: app.id, key: app.packageName, label: app.label, status: 'healthy', unread: app.unread ?? 0, kind: 'app', score: score(app, false), order: input.providers.length + order });
  });
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  const maxVisible = input.maxVisible ?? 4;
  const connectedPackages = new Set(input.deviceApps.map((app) => app.packageName));
  const unconnectedApps = input.discoveredApps.filter((app) => !connectedPackages.has(app.packageName));
  return {
    visible: candidates.slice(0, maxVisible).map(({ score: _score, order: _order, ...item }) => item),
    overflowCount: Math.max(0, candidates.length - maxVisible),
    collapsedAppCount: unconnectedApps.length,
    collapsedAppIconUris: unconnectedApps.flatMap((app) => app.iconDataUri ? [app.iconDataUri] : []).slice(0, 4),
  };
}

function score(item: { pinned?: boolean; unread?: number; lastUsedAt?: string | null; useCount?: number }, actionRequired: boolean) {
  const recent = item.lastUsedAt ? Math.max(0, Date.parse(item.lastUsedAt) || 0) / 1_000_000_000_000 : 0;
  return (item.pinned ? 100_000 : 0) + (actionRequired ? 10_000 : 0) + Math.min(item.unread ?? 0, 99) * 100 + Math.min(item.useCount ?? 0, 99) + recent;
}
