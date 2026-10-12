// Isolated process test: built original report Worker with fixture model outputs.
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Test } = require('@nestjs/testing');
const send = value => process.send?.({ ...value, pid: process.pid, at: new Date().toISOString() });
process.on('disconnect', () => process.exit(0));
async function main() {
  const database = new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid');
  const redis = new URL(process.env.REDIS_URL || 'redis://invalid');
  if (database.hostname !== '127.0.0.1' || database.port !== '3311'
      || !/^\/lazy_armor_v93_method_process_\d{8}_[a-f0-9]{8}_test$/.test(database.pathname)
      || database.pathname !== '/' + process.env.TEST_DATABASE_NAME || process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL
      || redis.hostname !== '127.0.0.1' || redis.port !== '6391' || redis.pathname !== '/15'
      || !process.env.REDIS_KEY_PREFIX?.startsWith('v93-method-process:') || process.env.REDIS_KEY_PREFIX !== process.env.TEST_REDIS_KEY_PREFIX
      || !['BLOCK_SECOND', 'BLOCK_WRITE', 'FINISH'].includes(process.env.V93_METHOD_CHILD_MODE)) throw new Error('ISOLATED_CHILD_REQUIRED');
  process.env.NODE_ENV = 'test'; process.env.APP_ROLE = 'api';
  globalThis.fetch = async () => { send({ event: 'NETWORK_ATTEMPT' }); throw new Error('FIXTURE_NETWORK_DISABLED'); };
  const dist = path.resolve(__dirname, '../../dist');
  const { AppModule } = require(path.join(dist, 'app.module.js'));
  const { ReportModelService } = require(path.join(dist, 'agent/reports/report-model.service.js'));
  const { ReportGenerationService } = require(path.join(dist, 'agent/reports/report-generation.service.js'));
  const sections = ['目标', '条件', '风险', '学习建议'];
  const plan = { title: '隔离方法进程恢复', prompt: '根据用户目标与所选方法生成报告，所有条件为隔离开发假设。'.repeat(8), sections,
    assumptions: ['开发验收假设'], researchQuestions: [], connectionIds: [], financialModel: null };
  const account = async control => { await control.reserve(); await control.recordUsage({ total_tokens: 42 }); };
  const fixture = {
    plan: async (_owner, _goal, _sources, _context, control) => {
      await account(control); send({ event: 'PLAN' }); return { value: plan, modelId: 'process-method-fixture' };
    },
    runMethod: async (_owner, _goal, _plan, _composition, method, inputs, _sources, control) => {
      await account(control);
      send({ event: 'METHOD', name: method.manifest.name, inputHash: createHash('sha256').update(JSON.stringify(inputs)).digest('hex') });
      if (method.manifest.name === 'ProcessReport' && process.env.V93_METHOD_CHILD_MODE === 'BLOCK_SECOND') return new Promise(() => {});
      return { value: { outputs: method.manifest.name === 'ProcessResearch' ? { research: '已保存研究：' + inputs.goal } : { report: '下游报告材料：' + inputs.research }, sourceIds: [] }, modelId: 'process-method-fixture' };
    },
    write: async (_owner, _goal, _plan, _sources, _warnings, _correction, control, _context, results) => {
      await account(control); send({ event: 'WRITE', savedMethods: results?.length });
      if (process.env.V93_METHOD_CHILD_MODE === 'BLOCK_WRITE') return new Promise(() => {});
      return { value: { markdown: sections.map(section => `## ${section}\n` + '开发隔离验收假设，学习效果待核实。'.repeat(30)).join('\n\n') }, modelId: 'process-method-fixture' };
    },
    review: async (_owner, _markdown, _plan, _sources, control, _context, results) => {
      await account(control); send({ event: 'REVIEW', savedMethods: results?.length });
      return { value: { issues: [] }, modelId: 'process-method-fixture' };
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ReportModelService).useValue(fixture).compile();
  const app = moduleRef.createNestApplication({ logger: false }); await app.init();
  process.env.NODE_ENV = 'development'; process.env.APP_ROLE = 'execution-worker';
  try { app.get(ReportGenerationService).onModuleInit(); }
  finally { process.env.NODE_ENV = 'test'; process.env.APP_ROLE = 'api'; }
  send({ event: 'READY' });
}
main().catch(() => { send({ event: 'CHILD_FAILED' }); process.exit(1); });
