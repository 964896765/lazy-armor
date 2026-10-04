import { describe, expect, it } from 'vitest';
import { serverDevelopmentAi } from '../src/ai-provider-config/server-development-ai';
const config = { NODE_ENV: 'development', DEEPSEEK_SERVER_DEV_ENABLED: '1', AGENT_MODEL_PROVIDER: 'deepseek', AGENT_MODEL_BASE_URL: 'https://api.deepseek.com', AGENT_MODEL_API_KEY: 'private-test-key', AGENT_MODEL_NAME: 'deepseek-flash' };
describe('server development AI credentials', () => {
 it('requires explicit development opt-in and exact official HTTPS provider', () => {
  expect(serverDevelopmentAi(config)?.source).toBe('SERVER_DEVELOPMENT');
  for (const overrides of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { DEEPSEEK_SERVER_DEV_ENABLED: '0' }, { AGENT_MODEL_BASE_URL: 'http://api.deepseek.com' }, { AGENT_MODEL_PROVIDER: 'fixture' }, { AGENT_MODEL_API_KEY: '' }]) expect(serverDevelopmentAi({ ...config, ...overrides })).toBeNull();
 });
});
