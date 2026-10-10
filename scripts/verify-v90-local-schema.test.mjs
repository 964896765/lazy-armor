import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BETA_METHOD_TABLES, localBetaDatabaseTarget, summarizeBetaSchema } from './lib/beta-local-schema.mjs';

const local = { APP_ENV: 'development', DATABASE_URL: 'mysql://user:private-secret@127.0.0.1:3307/lazy_armor' };
const expected = [{ tag: '0089_memory_relations', when: 10, hash: 'old-code-hash' }, { tag: '0090_skill_repositories', when: 20, hash: 'method-code-hash' }];
const ledger = expected.map(row => ({ created_at: String(row.when), hash: row.hash }));
test('local target validation refuses other environments, hosts, ports and databases before database access', () => {
  assert.deepEqual(localBetaDatabaseTarget(local), { host: '127.0.0.1', port: 3307, database: 'lazy_armor' });
  for (const env of [{ ...local, APP_ENV: 'staging' }, { ...local, APP_ENV: 'production' }, { ...local, NODE_ENV: 'production' },
    { ...local, DATABASE_URL: local.DATABASE_URL.replace('127.0.0.1', 'db.example.com') },
    { ...local, DATABASE_URL: local.DATABASE_URL.replace('3307', '3311') }, { ...local, DATABASE_URL: local.DATABASE_URL + '_test' },
    { ...local, DATABASE_URL: 'private-secret-invalid-url' }]) {
    assert.throws(() => localBetaDatabaseTarget(env), error => error.message === 'LOCAL_DEVELOPMENT_TARGET_REQUIRED' && !error.message.includes('private-secret'));
  }
});
test('detects pending migration even when dependency health could return 200', () => {
  const result = summarizeBetaSchema(expected, ledger.slice(0, 1), []);
  assert.deepEqual(result.pendingMigrations, ['0090_skill_repositories']);
  assert.equal(result.methodsSchemaReady, false); assert.equal(result.schemaReady, false);
});
test('requires both matching migration and every actual method table', () => {
  for (const missing of BETA_METHOD_TABLES) assert.equal(summarizeBetaSchema(expected, ledger, BETA_METHOD_TABLES.filter(name => name !== missing)).methodsSchemaReady, false);
  assert.equal(summarizeBetaSchema(expected, ledger.slice(0, 1), BETA_METHOD_TABLES).methodsSchemaReady, false);
  assert.equal(summarizeBetaSchema(expected, ledger, BETA_METHOD_TABLES).schemaReady, true);
});
test('preserves historical drift separately from current method availability instead of replacing ledger hashes', () => {
  const drifted = [{ created_at: '10', hash: 'historical-applied-hash' }, ledger[1]], before = structuredClone(drifted);
  const result = summarizeBetaSchema(expected, drifted, BETA_METHOD_TABLES);
  assert.equal(result.methodsSchemaReady, true); assert.equal(result.schemaReady, false);
  assert.deepEqual(result.historicalHashDrift, ['0089_memory_relations']); assert.deepEqual(drifted, before);
});
test('refuses mismatched, duplicated or unexpected ledger history', () => {
  for (const rows of [[ledger[0], { ...ledger[1], hash: 'different' }], [...ledger, ledger[1]], [...ledger, { created_at: 30, hash: 'future' }]])
    assert.equal(summarizeBetaSchema(expected, rows, BETA_METHOD_TABLES).schemaReady, false);
});
test('distinguishes known LF/CRLF byte differences while still rejecting changed SQL hashes', () => {
  const source = expected.map(row => ({ ...row, lineEndingHashes: [row.hash, row.hash + '-lf'] }));
  const alternate = [{ ...ledger[0], hash: ledger[0].hash + '-lf' }, ledger[1]], before = structuredClone(alternate);
  const result = summarizeBetaSchema(source, alternate, BETA_METHOD_TABLES);
  assert.equal(result.schemaReady, true); assert.equal(result.exactLedgerMatches, false);
  assert.deepEqual(result.lineEndingDifferences, ['0089_memory_relations']); assert.deepEqual(result.historicalHashDrift, []);
  assert.deepEqual(alternate, before);
  assert.equal(summarizeBetaSchema(source, [{ ...ledger[0], hash: 'changed-sql' }, ledger[1]], BETA_METHOD_TABLES).schemaReady, false);
});
