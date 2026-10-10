import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyLocalAndroidBundle } from './lib/beta-android-bundle.mjs';

const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--bundle', '--output'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Use --bundle UNMINIFIED_JS --output FRESH_JSON');
  options[args[index]] = args[index + 1];
}
if (!options['--bundle'] || !options['--output'] || existsSync(options['--output'])) throw new Error('Explicit bundle and fresh evidence required');
const report = { at: new Date().toISOString(), scope: 'Actual local Android JS build input configuration under empty device public env; not UI or real-user acceptance', passed: false };
try {
  const bytes = readFileSync(options['--bundle']);
  report.configuration = verifyLocalAndroidBundle(bytes.toString('utf8'));
  report.inputSha256 = createHash('sha256').update(bytes).digest('hex'); report.passed = true;
} catch { report.reason = 'LOCAL_ANDROID_CONFIG_NOT_EMBEDDED'; process.exitCode = 1; }
writeFileSync(options['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
