import { randomUUID } from 'node:crypto';
import { catalogHash, goalBriefSchema, reportCompositionSchema } from '@lazy-armor/plan-schema';

export function methodFixture() {
  const conversationId = randomUUID(), repositoryId = randomUUID(), firstId = randomUUID(), secondId = randomUUID();
  const ports = (properties: Record<string, { type: string }>, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });
  const manifest = (name: string, input: Record<string, any>, output: Record<string, any>) => ({ name, version: '1.0.0', domain: 'learning', description: '隔离方法转换', input, output, requiredCapabilities: [], permission: ['READ'], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '依据实际输入形成分析，不执行外部操作。' });
  const firstManifest = manifest('FirstMethod', ports({ goal: { type: 'string' } }, ['goal']), ports({ count: { type: 'integer' }, ready: { type: 'boolean' } }, ['count', 'ready']));
  const secondManifest = manifest('SecondMethod', ports({ count: { type: 'number' }, ready: { type: 'boolean' } }, ['count', 'ready']), ports({ report: { type: 'string' } }, ['report']));
  const ref = (id: string, manifest: unknown) => ({ repositoryId, repositoryVersion: 1, entryId: id, revisionId: randomUUID(), contentHash: catalogHash(manifest) });
  const firstRef = ref(firstId, firstManifest), secondRef = ref(secondId, secondManifest);
  const goal = goalBriefSchema.parse({ schemaVersion: 'goal-brief.v1', goalId: conversationId, version: 1, statement: '生成学习研究报告', domain: 'learning', lifecycle: 'TEMPORARY', outcomeKind: 'REPORT',
    fields: [{ key: 'goal', value: '生成学习研究报告', status: 'USER_STATED', sourceRefs: [{ kind: 'USER_MESSAGE', id: randomUUID(), quote: '生成学习研究报告' }] }], readiness: { state: 'READY_FOR_PROPOSAL', reasonCodes: [], questions: [], executionAuthorized: false }, executionAuthorized: false, createdAt: '2026-10-12T00:00:00.000Z' });
  const graph = { version: 1, goalBindings: [{ methodId: firstId, inputField: 'goal', goalField: 'goal' }],
    links: [{ fromMethodId: firstId, outputField: 'count', toMethodId: secondId, inputField: 'count' }, { fromMethodId: firstId, outputField: 'ready', toMethodId: secondId, inputField: 'ready' }], deliveries: [{ methodId: secondId, outputField: 'report', label: '研究报告' }] };
  const selection = { graph, basis: { goalBriefRef: { goalId: conversationId, version: 1, contentHash: catalogHash(goal) }, methodRefs: [firstRef, secondRef], sourceMessageRefs: [] } };
  return reportCompositionSchema.parse({ adapter: 'REPORT_METHOD_CHAIN_V1', methods: [{ ref: firstRef, manifest: firstManifest }, { ref: secondRef, manifest: secondManifest }], snapshot: { schemaVersion: 'composition-authoring.v1', kind: 'PLANNING_REFERENCE', executionAuthorized: false, runtimeRecipe: 'NOT_COMPILED', selection, selectionHash: catalogHash(selection), sourceAssistant: { id: randomUUID(), payloadHash: 'a'.repeat(64) }, sourceGoal: goal, orderedMethodIds: [firstId, secondId], riskFloor: 'R0', resourcesObservedAt: '2026-10-12T00:00:00.000Z', reportReadBindings: [] } });
}
