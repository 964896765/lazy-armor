// Task-owned test child. Uses built production services; only model output is a fixture.
const { createHash } = require('node:crypto');
const path = require('node:path');
const { Test } = require('@nestjs/testing');

const send = value => process.send?.({ ...value, pid: process.pid, observedAt: new Date().toISOString() });
// Do not leave a blocked fixture running if the test runner itself is interrupted.
process.on('disconnect', () => process.exit(0));
async function main() {
  const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid');
  const redis = new URL(process.env.REDIS_URL || 'redis://invalid');
  const local = database.port === '3311' && redis.port === '6391';
  const ci = process.env.CI === 'true' && database.pathname === '/lazy_armor_ci_test' && redis.port === '6379';
  if (database.hostname !== '127.0.0.1' || redis.hostname !== '127.0.0.1' || (!local && !ci)
      || !/^\/lazy_armor_[a-z0-9_]+_test$/.test(database.pathname)
      || database.pathname !== '/' + process.env.TEST_DATABASE_NAME || redis.pathname !== '/15'
      || !process.env.REDIS_KEY_PREFIX?.startsWith('v91-process:')
      || process.env.REDIS_KEY_PREFIX !== process.env.TEST_REDIS_KEY_PREFIX
      || !['BLOCK', 'FINISH'].includes(process.env.V91_CHILD_MODE)) throw new Error('ISOLATED_CHILD_REQUIRED');
  if (process.env.V91_CHILD_REPORTS === '1' && !/^\/lazy_armor_v91_process_\d{8}_[a-f0-9]{8}_test$/.test(database.pathname))
    throw new Error('FRESH_REPORT_RECOVERY_TARGET_REQUIRED');
  process.env.NODE_ENV = 'test'; process.env.APP_ROLE = 'api';
  globalThis.fetch = async () => { send({ event: 'NETWORK_ATTEMPT' }); throw new Error('FIXTURE_CHILD_NETWORK_DISABLED'); };
  const dist = path.resolve(__dirname, '../../dist');
  const { AppModule } = require(path.join(dist, 'app.module.js'));
  const { AGENT_MODEL } = require(path.join(dist, 'ai-adapter/agent-planner.service.js'));
  const { FakeAgentModel } = require(path.join(dist, 'ai-adapter/agent-model-adapter.js'));
  const { AuthoringJobsService } = require(path.join(dist, 'orchestrator/authoring-jobs.service.js'));
  const { ReportModelService } = require(path.join(dist, 'agent/reports/report-model.service.js'));
  const { ReportGenerationService } = require(path.join(dist, 'agent/reports/report-generation.service.js'));
  class ProcessFixtureModel extends FakeAgentModel {
    async complete(input) {
      send({ event: 'MODEL_ENTERED', intentHash: createHash('sha256').update(input.intent).digest('hex') });
      if (process.env.V91_CHILD_MODE === 'BLOCK') return new Promise(() => {});
      return super.complete(input);
    }
  }
  const sections = ['市场条件', '投入与成本', '盈亏情景', '核验与建议'];
  const reportPlan = { title: '隔离报告进程恢复', prompt: '这是开发隔离报告验收，所有经营参数为明确假设，不代表当地事实。'.repeat(6),
    sections, assumptions: ['开发隔离验收假设'], researchQuestions: ['当地经营条件待核实'], connectionIds: [],
    financialModel: { operatingDays: 30, startupCosts: [{ name: '模型投入假设', yuan: 60000 }], fixedMonthlyCosts: [{ name: '模型月成本假设', yuan: 9000 }], monthlyDepreciationYuan: 1000,
      scenarios: [10, 20, 30].map(carsPerDay => ({ name: `${carsPerDay}台`, carsPerDay, washPriceYuan: 30, washVariableYuan: 6,
        beautyConversion: 0.1, beautyPriceYuan: 100, beautyVariableRate: 0.4 })) } };
  const reportFixture = {
    plan: async (_userId, goal) => { send({ event: 'REPORT_PLAN', intentHash: createHash('sha256').update(goal).digest('hex') }); return { value: reportPlan, modelId: 'process-report-fixture' }; },
    write: async (_userId, goal) => {
      send({ event: 'REPORT_WRITE_ENTERED', intentHash: createHash('sha256').update(goal).digest('hex') });
      if (process.env.V91_CHILD_MODE === 'BLOCK') return new Promise(() => {});
      return { value: { markdown: sections.map(section => `## ${section}\n\n` + '此为开发隔离验收的模型假设分析，具体经营事实待核实，财务结果引用[M1]。'.repeat(10)).join('\n\n') }, modelId: 'process-report-fixture' };
    },
    review: async () => { send({ event: 'REPORT_REVIEW' }); return { value: { issues: [] }, modelId: 'process-report-fixture' }; },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AGENT_MODEL).useValue(new ProcessFixtureModel()).overrideProvider(ReportModelService).useValue(reportFixture).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  // Start only the existing authoring worker, leaving all other test workers disabled.
  process.env.NODE_ENV = 'development'; process.env.APP_ROLE = 'execution-worker';
  try { app.get(AuthoringJobsService).onModuleInit(); if (process.env.V91_CHILD_REPORTS === '1') app.get(ReportGenerationService).onModuleInit(); }
  finally { process.env.NODE_ENV = 'test'; process.env.APP_ROLE = 'api'; }
  send({ event: 'WORKER_READY' });
}
main().catch(() => { send({ event: 'CHILD_FAILED', code: 'AUTHORING_TEST_CHILD_FAILED' }); process.exit(1); });
