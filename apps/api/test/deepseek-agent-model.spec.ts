import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteAgentModel } from '../src/ai-adapter/remote-agent-model';
import type { AiProviderConfigService } from '../src/ai-provider-config/ai-provider-config.service';
import type { AgentModelRequest } from '../src/ai-adapter/agent-model-adapter';

const request = { userId: 'user-1', intent: '普通问答', context: { sections: [] } } as unknown as AgentModelRequest;
function model(mode = 'FAST') {
 const resolve = vi.fn().mockResolvedValue({ apiKey: 'test-secret-never-return', model: 'deepseek-flash', thinkingMode: mode });
 return { adapter: new RemoteAgentModel({ resolve } as unknown as AiProviderConfigService), resolve };
}
const answer = { result: 'ANSWER', intentSummary: '问题', domain: null, scenarioKey: null, scenarioRevision: null, strategyKey: null, requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [], draftDefinition: null, explanation: '回答', missingRequirements: [], warnings: [], riskHints: [] };
afterEach(() => vi.unstubAllGlobals());
describe('DeepSeek proposal adapter', () => {
 it('reports an insufficient upstream balance without falling back to a fixture', async () => {
  const fetch = vi.fn().mockResolvedValue({ok:false,status:402});vi.stubGlobal('fetch',fetch);
  await expect(model().adapter.complete(request)).rejects.toThrow('AI_PROVIDER_BALANCE_INSUFFICIENT');expect(fetch).toHaveBeenCalledTimes(1);
 });
 it('requires user identity before resolving any credentials', async () => {
  const { adapter, resolve } = model();
  await expect(adapter.complete({ ...request, userId: undefined })).rejects.toThrow('AI_USER_CONTEXT_REQUIRED');
  expect(resolve).not.toHaveBeenCalled();
 });
 it('resolves per-user credentials and returns only validated output', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }); vi.stubGlobal('fetch', fetch);
  const { adapter, resolve } = model(); expect(await adapter.complete(request)).toEqual(answer);
  expect(resolve).toHaveBeenCalledWith('user-1');
  const [url, options] = fetch.mock.calls[0]; expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(JSON.parse(options.body).thinking).toEqual({ type: 'disabled' });
  expect(JSON.parse(options.body).tools).toBeUndefined();
 });
 it('maps deep mode to thinking and high effort', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(answer) } }] }) }); vi.stubGlobal('fetch', fetch);
  await model('DEEP').adapter.complete(request);
  const body = JSON.parse(fetch.mock.calls[0][1].body); expect(body.thinking.type).toBe('enabled'); expect(body.reasoning_effort).toBe('high');
 });
 it('rejects executable or malformed model output', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...answer, result: 'EXECUTE', apiKey: 'injected' }) } }] }) }));
  await expect(model().adapter.complete(request)).rejects.toThrow('模型输出未通过安全合同验证');
 });
 it('does not include upstream error bodies or secrets in errors', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'test-secret-never-return' }));
  await expect(model().adapter.complete(request)).rejects.toThrow('模型暂时不可用，请稍后重试');
 });
});
