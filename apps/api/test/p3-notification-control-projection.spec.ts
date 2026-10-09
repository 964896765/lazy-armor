import { auditLogs, planCreationContracts } from '@lazy-armor/database';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it, vi } from 'vitest';
import { PlanControlProjectionService } from '../src/plans/plan-control-projection.service';

const owner = '01a0ccc2-63e5-7238-95d3-2fc87835e8bb';
const planId = '01a11c37-59ce-76ed-9de4-ae5a0e8b87f6';
const versionId = '01a11c37-59f6-77b1-9572-dcdf801da096';
const connectionId = '01a11c38-f070-746d-a10f-ba2a4ec87a91';
const trustedDeviceId = '01a0fb24-2dc0-719e-a0db-3da7fb52a5d4';
const parameters = { recipeKey: 'notification.shipment-watch.v1', sourcePackage: 'com.jingdong.app.mall', connectionId, trustedDeviceId, lookbackHours: 168, notificationPolicy: 'EXCEPTION_ONLY' };

/** Read model fixtures, not evidence of device execution or shipment Truth. */
function fixture(options: { status?: string; checkpointState?: string; checkpointVersion?: string; checkpointOwner?: string; reasons?: string[]; selectedConnection?: string; selectedDevice?: string; recipeKey?: string } = {}) {
  const scopes: unknown[][] = [];
  const contract = { scenarioKey: 'not-a-valid-fixture-scenario', scenarioRevision: 2, goalJson: { constraints: { recipeKey: options.recipeKey ?? parameters.recipeKey, notificationWatchJson: JSON.stringify(parameters) } }, subjectJson: {} };
  const checkpoint = { userId: options.checkpointOwner ?? owner, resourceId: options.checkpointVersion ?? versionId, afterSnapshotJson: { schema: 'plan-notification-gap.v1', planVersionId: options.checkpointVersion ?? versionId, state: options.checkpointState ?? 'WAITING_FACT_CHANGE' } };
  const dialect = new MySqlDialect();
  const db = { select: vi.fn(() => {
    let table: unknown, scope: unknown[] = [];
    const query = {
      from(value: unknown) { table = value; return query; },
      where(value: any) { scope = dialect.sqlToQuery(value).params.map(param => {
        if (!Buffer.isBuffer(param)) return param;
        const hex = param.toString('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      }); if (table === auditLogs) scopes.push(scope); return query; },
      innerJoin() { return query; }, leftJoin() { return query; }, orderBy() { return query; },
      limit() { return Promise.resolve(table === planCreationContracts ? [contract] : table === auditLogs && scope.includes(checkpoint.userId) && scope.includes(checkpoint.resourceId) ? [checkpoint] : []); },
    };
    return query;
  }) };
  const plans = { get: vi.fn(async () => ({ status: options.status ?? 'active', activeVersionId: versionId, currentVersionId: '01a11c37-7a6e-7321-81fb-8aca2266206f' })) };
  const assembler = { assembleById: vi.fn(async () => ({ version: { name: '京东物流异常提醒', description: null, templateKey: null }, definition: { actions: [] } })) };
  const facts = { resolveNotificationQuery: vi.fn(async () => options.reasons ? { state: 'WAITING_RESOURCE', reasons: options.reasons, selected: null } : { state: 'RESOLVED', reasons: [], selected: { connectionId: options.selectedConnection ?? connectionId, trustedDeviceId: options.selectedDevice ?? trustedDeviceId } }) };
  return { service: new PlanControlProjectionService(db as never, plans as never, assembler as never, facts as never), db, plans, facts, scopes };
}

describe('notification Plan detail current state authority', () => {
  it('shows current permission loss instead of a historical successful empty read', async () => {
    const f = fixture({ checkpointState: 'WAITING_FACT_CHANGE', reasons: ['NOTIFICATION_GRANT_REQUIRED'] });
    const projection = await f.service.forPlan(owner, planId);
    expect(projection.notificationWatchState).toMatchObject({ state: 'WAITING_RESOURCE', label: '等待资源恢复' });
    expect(projection.notificationWatchState?.nextStep).toContain('需要允许读取本机通知');
    expect(f.scopes).toHaveLength(0);
  });

  it('does not substitute another authorized connection or phone for the frozen source', async () => {
    for (const override of [{ selectedConnection: 'different-source' }, { selectedDevice: 'different-phone' }]) {
      const f = fixture(override);
      expect((await f.service.forPlan(owner, planId)).notificationWatchState?.state).toBe('WAITING_RESOURCE');
    }
  });

  it('keeps empty acquisition separate from a claim that no shipment exists', async () => {
    const f = fixture();
    const projection = await f.service.forPlan(owner, planId);
    expect(projection.notificationWatchState).toMatchObject({ state: 'WAITING_FACT_CHANGE', label: '等待新物流线索' });
    expect(projection.notificationWatchState?.nextStep).toContain('不能证明没有快递');
    expect(f.scopes[0]).toEqual([owner, 'plan_version', versionId, 'PERSISTENT_NOTIFICATION_RESOURCE_STATE']);
  });

  it('publishes pending read and candidate confirmation as different next steps', async () => {
    const pending = await fixture({ checkpointState: 'READ_PENDING' }).service.forPlan(owner, planId);
    const candidate = await fixture({ checkpointState: 'WAITING_FACT_CONFIRMATION' }).service.forPlan(owner, planId);
    expect(pending.notificationWatchState?.label).toBe('正在读取通知');
    expect(candidate.notificationWatchState?.label).toBe('需要核实物流线索');
    expect(candidate.notificationWatchState?.nextStep).toContain('核实');
  });

  it('ignores checkpoints from another owner or PlanVersion', async () => {
    for (const override of [{ checkpointOwner: 'different-owner' }, { checkpointVersion: 'different-version' }]) {
      const projection = await fixture(override).service.forPlan(owner, planId);
      expect(projection.notificationWatchState?.state).toBe('WAITING_READ');
    }
  });

  it('does not override paused, draft, archived or unrelated Plan semantics', async () => {
    for (const status of ['paused', 'draft', 'archived']) {
      const f = fixture({ status });
      expect((await f.service.forPlan(owner, planId)).notificationWatchState).toBeUndefined();
      expect(f.facts.resolveNotificationQuery).not.toHaveBeenCalled();
    }
    const f = fixture({ recipeKey: 'calendar.scheduled-create.v1' });
    expect((await f.service.forPlan(owner, planId)).notificationWatchState).toBeUndefined();
  });

  it('performs the canonical owner check before reading any projection data', async () => {
    const f = fixture();
    f.plans.get.mockRejectedValueOnce(new Error('owner-mismatch'));
    await expect(f.service.forPlan('different-owner', planId)).rejects.toThrow('owner-mismatch');
    expect(f.db.select).not.toHaveBeenCalled();
  });
});
