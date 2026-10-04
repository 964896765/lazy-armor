/** Private server-only development credentials. Never returned by an API. */
export function serverDevelopmentAi(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'development' || env.DEEPSEEK_SERVER_DEV_ENABLED !== '1') return null;
  if (env.AGENT_MODEL_PROVIDER !== 'deepseek' || env.AGENT_MODEL_BASE_URL !== 'https://api.deepseek.com') return null;
  const apiKey = env.AGENT_MODEL_API_KEY?.trim();
  const model = env.AGENT_MODEL_NAME?.trim();
  if (!apiKey || !model) return null;
  return { apiKey, model, thinkingMode: 'AUTO', credentialId: null, source: 'SERVER_DEVELOPMENT' as const };
}
