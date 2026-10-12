import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL, fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { AndroidConfig } = require('@expo/config-plugins');
const pluginPath = new NodeURL('../plugins/with-lazy-armor-android-runtime.js', import.meta.url);
const name = (item: any) => item?.$?.['android:name'];
const launcher = (intent: any) => intent.action?.some((item: any) => name(item) === 'android.intent.action.MAIN') && intent.category?.some((item: any) => name(item) === 'android.intent.category.LAUNCHER');
/** Exercise the real manifest callback without running Gradle/source-copy mods in the workspace. */
function manifestCallback() {
  let callback: any;
  const module = { exports: undefined as any };
  const passthrough = (config: any) => config;
  runInNewContext(fs.readFileSync(pluginPath, 'utf8'), { module, require: (id: string) => id === '@expo/config-plugins' ? {
    createRunOncePlugin: (fn: any) => fn,
    withAndroidManifest: (config: any, fn: any) => { callback = fn; return config; },
    withDangerousMod: passthrough, withGradleProperties: passthrough, withMainApplication: passthrough,
  } : require(id), __dirname: fileURLToPath(new NodeURL('../plugins/', import.meta.url)) });
  module.exports({}); return callback;
}
describe('launchable app visibility survives Android regeneration', () => {
  it('adds the matching launcher query once, preserving existing query scopes and permissions', () => {
    const apply = manifestCallback(), existing = { action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'https' } }] };
    let config = { modResults: { manifest: { application: [{}], queries: [{ intent: [existing] }] } } };
    config = apply(apply(config)); const manifest: any = config.modResults.manifest;
    expect(manifest.queries.flatMap((root: any) => root.intent ?? []).filter(launcher)).toHaveLength(1);
    expect(manifest.queries[0].intent).toContain(existing);
    expect(manifest.queries[0].package.some((item: any) => name(item) === 'com.miui.calculator')).toBe(true);
    expect(manifest['uses-permission'].some((item: any) => name(item) === 'android.permission.QUERY_ALL_PACKAGES')).toBe(false);
  });
  it('ships the same scoped query in the checked-in native manifest', async () => {
    const manifest = (await AndroidConfig.Manifest.readAndroidManifestAsync(fileURLToPath(new NodeURL('../android/app/src/main/AndroidManifest.xml', import.meta.url)))).manifest;
    expect(manifest.queries.flatMap((root: any) => root.intent ?? []).filter(launcher)).toHaveLength(1);
    expect(manifest['uses-permission'].some((item: any) => name(item) === 'android.permission.QUERY_ALL_PACKAGES')).toBe(false);
  });
});
