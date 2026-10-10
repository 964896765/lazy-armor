import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyLocalAndroidBundle } from './lib/beta-android-bundle.mjs';
const ts = createRequire(import.meta.url)('typescript');
const local = "function resolveAppEnv(){return 'development'} function resolveApiUrl(){return 'http://127.0.0.1:3001'}";
test('accepts correctly embedded local configuration without inheriting host public env', () => {
  assert.deepEqual(verifyLocalAndroidBundle(local), { appEnv: 'development', apiUrl: 'http://127.0.0.1:3001', deviceHasNoPublicEnv: true });
});
test('rejects the actual API module compiled without Expo public-env embedding', () => {
  const source = ts.transpileModule(readFileSync('apps/mobile/src/api.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  assert.throws(() => verifyLocalAndroidBundle(source), /LOCAL_ANDROID_CONFIG_NOT_EMBEDDED/);
});
test('rejects wrong environment, non-local URL, missing and ambiguous resolvers', () => {
  for (const source of [local.replace('development', 'production'), local.replace('127.0.0.1:3001', 'example.com'), '', local + local])
    assert.throws(() => verifyLocalAndroidBundle(source), /LOCAL_ANDROID_CONFIG_NOT_EMBEDDED/);
});
