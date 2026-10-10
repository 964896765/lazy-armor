import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');

// Inspect the actual unminified build input, with device-like empty public env.
// Only the repository's two configuration resolvers are evaluated, not the app.
export function verifyLocalAndroidBundle(source) {
  try {
    const file = ts.createSourceFile('local-android.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (file.parseDiagnostics.length) throw new Error('Invalid bundle');
    const functions = new Map();
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && ['resolveAppEnv', 'resolveApiUrl'].includes(node.name?.text)) {
        if (functions.has(node.name.text)) throw new Error('Ambiguous resolvers');
        functions.set(node.name.text, source.slice(node.getStart(file), node.end));
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (functions.size !== 2) throw new Error('Missing resolvers');
    const result = runInNewContext([...functions.values()].join('\n') + '\n({ appEnv: resolveAppEnv(), apiUrl: resolveApiUrl() })',
      { process: { env: { NODE_ENV: 'production' } }, URL }, { timeout: 1000 });
    if (result.appEnv !== 'development' || result.apiUrl !== 'http://127.0.0.1:3001') throw new Error('Wrong local configuration');
    return { appEnv: result.appEnv, apiUrl: result.apiUrl, deviceHasNoPublicEnv: true };
  } catch { throw new Error('LOCAL_ANDROID_CONFIG_NOT_EMBEDDED'); }
}
