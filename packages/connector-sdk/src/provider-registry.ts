import { candidateCapability, type ProviderCapabilityManifest, type SourceMode, validateProviderCapabilityManifest } from './capability-manifest';

interface ProviderSkeletonInput { key: string; name: string; candidateKey: string; candidateName: string; resource: string; sourceModes: SourceMode[] }

const PROVIDERS: ProviderSkeletonInput[] = [
  { key: 'wechat', name: '微信', candidateKey: 'READ_MESSAGES', candidateName: '读取消息候选', resource: 'communication.message', sourceModes: ['NOTIFICATION', 'SHARE', 'APP_READ'] },
  { key: 'alipay', name: '支付宝', candidateKey: 'READ_TRANSACTIONS', candidateName: '读取交易候选', resource: 'finance.transaction', sourceModes: ['NOTIFICATION', 'APP_READ'] },
  { key: 'taobao', name: '淘宝', candidateKey: 'READ_ORDERS', candidateName: '读取订单候选', resource: 'commerce.order', sourceModes: ['NOTIFICATION', 'APP_READ'] },
  { key: 'jd', name: '京东', candidateKey: 'READ_ORDERS', candidateName: '读取订单候选', resource: 'commerce.order', sourceModes: ['NOTIFICATION', 'APP_READ'] },
  { key: 'gmail', name: 'Gmail', candidateKey: 'READ_EMAIL', candidateName: '读取邮件候选', resource: 'communication.email', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'google_calendar', name: 'Google Calendar', candidateKey: 'READ_EVENT', candidateName: '读取日历候选', resource: 'calendar.event', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'google_contacts', name: 'Google Contacts', candidateKey: 'READ_CONTACTS', candidateName: '读取联系人候选', resource: 'identity.contact', sourceModes: ['OFFICIAL_API'] },
  { key: 'douyin', name: '抖音', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['NOTIFICATION', 'SHARE', 'APP_READ'] },
  { key: 'kuaishou', name: '快手', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['NOTIFICATION', 'SHARE', 'APP_READ'] },
  { key: 'bilibili', name: '哔哩哔哩', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['NOTIFICATION', 'SHARE', 'APP_READ'] },
  { key: 'xiaohongshu', name: '小红书', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['NOTIFICATION', 'SHARE', 'APP_READ'] },
  { key: 'youtube', name: 'YouTube', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'instagram', name: 'Instagram', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'x', name: 'X', candidateKey: 'READ_CONTENT', candidateName: '读取内容候选', resource: 'content.publication', sourceModes: ['OFFICIAL_API'] },
  { key: 'telegram', name: 'Telegram', candidateKey: 'READ_MESSAGES', candidateName: '读取消息候选', resource: 'communication.message', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'discord', name: 'Discord', candidateKey: 'READ_MESSAGES', candidateName: '读取消息候选', resource: 'communication.message', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'notion', name: 'Notion', candidateKey: 'READ_PAGES', candidateName: '读取页面候选', resource: 'work.document', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
  { key: 'github', name: 'GitHub', candidateKey: 'READ_REPOSITORY', candidateName: '读取仓库候选', resource: 'work.repository', sourceModes: ['OFFICIAL_API', 'WEBHOOK'] },
];

export const PROVIDER_REGISTRY: readonly ProviderCapabilityManifest[] = Object.freeze(PROVIDERS.map((provider): ProviderCapabilityManifest => ({
  schemaVersion: '1' as const,
  providerKey: provider.key,
  providerName: provider.name,
  revision: 1,
  accountTypes: ['consumer'],
  sourceModes: provider.sourceModes,
  actionModes: ['OBSERVE'],
  providerReview: 'TO_VERIFY_OFFICIAL' as const,
  rateLimitPolicy: 'TO_VERIFY_OFFICIAL',
  capabilities: [candidateCapability({ key: provider.candidateKey, name: provider.candidateName, resource: provider.resource, sourceModes: provider.sourceModes })],
  evidence: [{ kind: 'MANUAL_REVIEW' as const, status: 'TO_VERIFY_OFFICIAL' as const, summary: 'Provider 骨架已登记，官方能力、配额与审核要求待逐项核实。' }],
  explicitDenials: [],
})));

export class ProviderCapabilityRegistry {
  private readonly manifests = new Map(PROVIDER_REGISTRY.map((manifest) => [manifest.providerKey, validateProviderCapabilityManifest(manifest)]));
  list() { return [...this.manifests.values()].map((manifest) => structuredClone(manifest)); }
  get(providerKey: string) { const manifest = this.manifests.get(providerKey); return manifest ? structuredClone(manifest) : undefined; }
  register(value: ProviderCapabilityManifest) {
    const { manifestHash: _hash, ...raw } = value as ProviderCapabilityManifest & { manifestHash?: string };
    const manifest = validateProviderCapabilityManifest(structuredClone(raw));
    if (_hash && _hash !== manifest.manifestHash) throw new Error('Provider manifest digest mismatch');
    const prior = this.manifests.get(manifest.providerKey);
    if (prior && (manifest.revision < prior.revision || (manifest.revision === prior.revision && manifest.manifestHash !== prior.manifestHash))) throw new Error('Provider manifest revisions are immutable and monotonic');
    this.manifests.set(manifest.providerKey, manifest);
    return structuredClone(manifest);
  }
  require(providerKey: string) { const manifest = this.get(providerKey); if (!manifest) throw new Error(`Unknown provider capability manifest: ${providerKey}`); return manifest; }
}
