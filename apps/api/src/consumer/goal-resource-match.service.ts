import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { connections, consumerConversations, consumerMessages, deviceAppConnections, deviceHeartbeats, trustedDevices } from '@lazy-armor/database';
import { canonicalCapabilityId, catalogHash, goalUnderstandingSchema, type GoalResourceCandidate, type GoalResourceMatch } from '@lazy-armor/plan-schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DATABASE, type InjectedDatabase } from '../common/database.module';
import { CapabilityUsabilityService } from '../provider-capabilities/capability-usability.service';
import { FactDemandResolverService } from '../fact-demands/fact-demand-resolver.service';
import { LocalCapabilitiesService } from './local-capabilities.service';
import { assertUiReadCapability } from '../app-read-sessions/ui-read-consent';

@Injectable()
export class GoalResourceMatchService {
  constructor(@Inject(DATABASE) private readonly db: InjectedDatabase, private readonly usability: CapabilityUsabilityService,
    private readonly native: LocalCapabilitiesService, private readonly facts: FactDemandResolverService) {}
  private async saved(userId: string, conversationId: string, messageId: string, version: number) {
    const conversation = (await this.db.select().from(consumerConversations).where(and(eq(consumerConversations.id, conversationId), eq(consumerConversations.userId, userId), isNull(consumerConversations.deletedAt))).limit(1))[0];
    if (!conversation) throw new NotFoundException('会话不存在');
    if (conversation.version !== version || conversation.status === 'PROCESSING' || conversation.archivedAt) throw new ConflictException('目标已更新，请回到原会话查看最新信息');
    const message = (await this.db.select().from(consumerMessages).where(and(eq(consumerMessages.conversationId, conversationId), eq(consumerMessages.role, 'assistant'))).orderBy(desc(consumerMessages.createdAt), desc(consumerMessages.id)).limit(1))[0];
    const parsed = goalUnderstandingSchema.safeParse(message?.structuredPayload?.understanding);
    if (!message || message.id !== messageId || !parsed.success || parsed.data.capabilities.length > 30) throw new ConflictException('此目标理解已失效，请回到原会话');
    return { understanding: parsed.data, hash: catalogHash(message.structuredPayload) };
  }
  async match(userId: string, conversationId: string, messageId: string, version: number): Promise<GoalResourceMatch> {
    const saved = await this.saved(userId, conversationId, messageId, version);
    const ownedConnections = await this.db.select({ id: connections.id }).from(connections).where(eq(connections.userId, userId));
    const views = await Promise.all(ownedConnections.map(row => this.usability.resolveConnection(userId, row.id)));
    const native = await this.native.project(userId);
    const devices = await this.db.select({ device: trustedDevices, heartbeat: deviceHeartbeats }).from(trustedDevices)
      .leftJoin(deviceHeartbeats, eq(deviceHeartbeats.trustedDeviceId, trustedDevices.id)).where(eq(trustedDevices.userId, userId));
    const returnPath = '/chat?conversationId=' + conversationId;
    const requirements: GoalResourceMatch['requirements'] = [];
    for (const need of saved.understanding.capabilities) {
      const key = canonicalCapabilityId(need.key) ?? need.key;
      const resources: GoalResourceCandidate[] = [];
      if (key === 'app.notification.read') {
        const reason = need.sourcePackage ? await this.facts.resolveNotificationQuery(userId, need.sourcePackage, { refreshTargets: false }) : null;
        const selected = reason?.selected;
        const app = selected && (await this.db.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.id, selected.connectionId), eq(deviceAppConnections.userId, userId))).limit(1))[0];
        resources.push({ resourceId: selected?.connectionId ?? 'notification-source', name: app?.displayName ?? '应用通知来源',
          state: selected ? 'READY' : reason?.state === 'NEEDS_SOURCE_SELECTION' ? 'NEEDS_SELECTION' : 'UNAVAILABLE',
          reasons: reason?.reasons ?? ['APP_SOURCE_REQUIRED'], action: { label: '核对通知来源', path: '/connections/notification-sources?returnTo=' + encodeURIComponent(returnPath) } });
      } else if (key === 'structured_read.field' && need.sourcePackage === 'com.miui.calculator') {
        const sources = await this.db.select().from(deviceAppConnections).where(and(eq(deviceAppConnections.userId, userId), eq(deviceAppConnections.packageName, need.sourcePackage)));
        for (const app of sources) {
          const row = devices.find(d => d.device.id === app.trustedDeviceId);
          const online = row?.device.status === 'active' && !row.device.revokedAt && row.heartbeat?.onlineState === 'online'
            && row.heartbeat.lastHeartbeatAt <= new Date() && Date.now() - row.heartbeat.lastHeartbeatAt.getTime() <= 30000;
          const reasons: string[] = [];
          if (!app.enabled || !app.launchable) reasons.push('APP_SOURCE_REQUIRED');
          if (!online) reasons.push('WAITING_DEVICE');
          try { await assertUiReadCapability(this.db, userId, app.trustedDeviceId!); } catch { reasons.push('PAGE_READ_AUTHORIZATION_REQUIRED'); }
          const query = `connectionId=${app.id}&packageName=${encodeURIComponent(app.packageName)}&displayName=${encodeURIComponent(app.displayName)}&mode=UI_READ&conversationId=${conversationId}&messageId=${messageId}&version=${version}`;
          resources.push({ resourceId: app.id, name: app.displayName, state: reasons.length ? 'UNAVAILABLE' : 'READY', reasons,
            action: { label: reasons.length ? '补充权限并核对范围' : '核对本次读取范围', path: '/connections/app-read-session?' + query } });
        }
      } else {
        for (const view of views) for (const capability of view.capabilities.filter(c => (canonicalCapabilityId(c.key) ?? c.key) === key)) {
          resources.push({ resourceId: 'connection:' + view.connectionId, name: view.providerName, state: capability.usable ? 'READY' : 'UNAVAILABLE', reasons: capability.reasons,
            action: { label: '查看能力与授权', path: (view.providerKey === 'public_http_json' ? '/interface-detail' : '/resource-detail') + '?id=' + view.connectionId } });
        }
        for (const row of native.filter(r => (canonicalCapabilityId(r.capabilityState!.key) ?? r.capabilityState!.canonicalKey ?? r.capabilityState!.key) === key)) {
          const device = devices.find(d => row.resourceId.startsWith('local:' + d.device.id + ':'));
          const heartbeat = device?.heartbeat;
          const online = !!device && device.device.status === 'active' && !device.device.revokedAt && heartbeat?.userId === userId && heartbeat.deviceId === device.device.deviceId
            && heartbeat.onlineState === 'online' && heartbeat.lastHeartbeatAt <= new Date() && Date.now() - heartbeat.lastHeartbeatAt.getTime() <= 30000;
          const ready = online && row.capabilityState?.availability === 'AVAILABLE';
          resources.push({ resourceId: row.resourceId, name: row.name, state: ready ? 'READY' : 'UNAVAILABLE', reasons: online ? row.reasons : [...row.reasons, 'WAITING_DEVICE'],
            action: { label: '核对设备能力', path: '/resources?returnConversationId=' + conversationId } });
        }
      }
      requirements.push({ key, ...(need.sourcePackage ? { sourcePackage: need.sourcePackage } : {}), resources, reasons: resources.length ? [] : ['NO_CAPABILITY_PROVIDER'] });
    }
    if ((await this.saved(userId, conversationId, messageId, version)).hash !== saved.hash) throw new ConflictException('目标已更新，请回到原会话');
    return { schemaVersion: 'goal-resource-match.v1', conversationId, conversationVersion: version, messageId, proposalId: saved.understanding.proposalId,
      summary: saved.understanding.summary, evaluatedAt: new Date().toISOString(), executionAuthorized: false, requirements };
  }
}
