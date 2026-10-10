import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BETA_ROLE_PROBES, validRoleReadiness, probeRoleReadiness } from './lib/beta-readiness.mjs';

const dependencies = { mysql: 'ready', redis: 'PONG', bullmq: 'ready' };
test('probes the actual API health and worker readiness routes', () => {
  assert.deepEqual(BETA_ROLE_PROBES.map(probe => new URL(probe.url).pathname), ['/api/health', '/ready', '/ready']);
});
test('refuses liveness, degraded dependencies, HTTP failures and the wrong worker role', () => {
  assert.equal(validRoleReadiness('api', 200, { status: 'ok' }), false);
  assert.equal(validRoleReadiness('api', 200, { ...dependencies, status: 'degraded' }), false);
  assert.equal(validRoleReadiness('api', 503, { ...dependencies, status: 'ok' }), false);
  assert.equal(validRoleReadiness('execution-worker', 200, { ...dependencies, status: 'ready', role: 'outbox-worker', worker: { ready: true } }), false);
  assert.equal(validRoleReadiness('execution-worker', 200, { ...dependencies, status: 'ready', role: 'execution-worker', worker: { ready: false } }), false);
});
test('accepts only complete current role dependencies', () => {
  assert.equal(validRoleReadiness('api', 200, { ...dependencies, status: 'ok' }), true);
  for (const role of ['execution-worker', 'outbox-worker']) assert.equal(validRoleReadiness(role, 200, { ...dependencies, status: 'ready', role, worker: { ready: true } }), true);
});
test('does not expose raw response fields or transport errors in evidence', async () => {
  const probe = BETA_ROLE_PROBES[0];
  const success = await probeRoleReadiness(probe, async (_url, options) => {
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify({ ...dependencies, status: 'ok', privateValue: 'never-copy' }));
  });
  assert.equal(success.ready, true); assert.equal(JSON.stringify(success).includes('never-copy'), false);
  const failure = await probeRoleReadiness(probe, async () => { throw new Error('private-transport-detail'); });
  assert.equal(failure.ready, false); assert.equal(JSON.stringify(failure).includes('private-transport-detail'), false);
});
test('refuses invalid or oversized readiness bodies without optimistic fallback', async () => {
  for (const body of ['not json', 'x'.repeat(32769)]) assert.equal((await probeRoleReadiness(BETA_ROLE_PROBES[0], async () => new Response(body))).ready, false);
});
