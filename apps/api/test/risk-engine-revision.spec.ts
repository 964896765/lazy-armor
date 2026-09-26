import { beforeAll, describe, expect, it } from 'vitest';
import type { NormalizedAction } from '@lazy-armor/plan-schema';

// RiskEngine 的场景 revision 门禁回归：V1 目录、V2-only 场景、非法 revision 与
// 未知场景必须被区分对待，绝不能因为「查不到就放行」或「查到了但 revision 不符」。
// 该服务只依赖 scenarioDefinitionByKey + 一个可注入的 drizzle executor，因此用
// 最小 mock 直接验证门禁分支，而不需要拉起整套 Nest 应用。

const action: NormalizedAction = {
  actionType: 'notify',
  connectorKey: null,
  connectionId: null,
  requiredCapability: null,
  riskLevel: 'R1',
  config: {},
  stepOrder: 0,
};

function mockExecutor(binding: { scenarioKey: string; scenarioRevision: number } | null) {
  const rows = binding ? [binding] : [];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  };
}

describe('RiskEngine scenario revision gate', () => {
  let engine: { evaluate(action: NormalizedAction, declaredRisk: string, input: Record<string, unknown>, connectorId: null, executor: unknown, planVersionId?: string): Promise<{ scenarioRisk?: string }> };

  beforeAll(async () => {
    const { RiskEngine } = await import('../src/risk/risk-engine.service');
    engine = new RiskEngine({} as never) as unknown as typeof engine;
  });

  it('accepts a legal V1 immutable-catalog revision', async () => {
    const snapshot = await engine.evaluate(action, 'R1', {}, null, mockExecutor({ scenarioKey: 'daily_life.delivery', scenarioRevision: 2 }), 'plan-version-v1');
    expect(snapshot.scenarioRisk).toBe('R1');
  });

  it('accepts a legal V2-only scenario revision', async () => {
    const snapshot = await engine.evaluate(action, 'R1', {}, null, mockExecutor({ scenarioKey: 'finance.accounting', scenarioRevision: 1 }), 'plan-version-v2');
    expect(snapshot.scenarioRisk).toBe('R1');
  });

  it('rejects an unregistered revision instead of silently lowering the floor', async () => {
    await expect(
      engine.evaluate(action, 'R1', {}, null, mockExecutor({ scenarioKey: 'daily_life.delivery', scenarioRevision: 999 }), 'plan-version-bad'),
    ).rejects.toThrow(/Scenario risk policy revision unavailable/);
  });

  it('rejects an unknown scenario key', async () => {
    await expect(
      engine.evaluate(action, 'R1', {}, null, mockExecutor({ scenarioKey: 'unknown.scenario', scenarioRevision: 1 }), 'plan-version-unknown'),
    ).rejects.toThrow(/Scenario risk policy revision unavailable/);
  });
});
