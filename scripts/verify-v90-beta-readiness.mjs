import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { BETA_ROLE_PROBES, probeRoleReadiness } from './lib/beta-readiness.mjs';

// Read-only local prerequisites. Never starts services, changes permissions or closes a stage.
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--device', '--output'].includes(args[index]) || !args[index + 1] || options[args[index]]) throw new Error('Use --device SERIAL --output FRESH_JSON_PATH');
  options[args[index]] = args[index + 1];
}
const root = process.cwd(), output = options['--output'] ? path.resolve(root, options['--output']) : null;
if (output && existsSync(output)) throw new Error('Fresh evidence path required');
const run = (command, arguments_) => execFileSync(command, arguments_, { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const observedAt = new Date().toISOString(), commit = run('git', ['rev-parse', 'HEAD']).trim();
const services = await Promise.all(BETA_ROLE_PROBES.map(probe => probeRoleReadiness(probe)));
const device = { serial: options['--device'] ?? null, connected: false, appInstalled: false, appUpdatedAt: null,
  observerSystemEnabled: false, normalLogin: 'NOT_CHECKED', appReadConsent: 'NOT_CHECKED' };
if (device.serial) {
  try {
    device.connected = run('adb', ['-s', device.serial, 'get-state']).trim() === 'device';
    const installed = run('adb', ['-s', device.serial, 'shell', 'dumpsys', 'package', 'com.lazyarmor.app']);
    device.appInstalled = /versionName=/.test(installed); device.appUpdatedAt = /lastUpdateTime=([^\r\n]+)/.exec(installed)?.[1].trim() ?? null;
    const enabled = run('adb', ['-s', device.serial, 'shell', 'settings', 'get', 'secure', 'accessibility_enabled']).trim();
    const listeners = run('adb', ['-s', device.serial, 'shell', 'settings', 'get', 'secure', 'enabled_accessibility_services']);
    device.observerSystemEnabled = enabled === '1' && listeners.split(':').some(value => /com\.lazyarmor\.app\/.*ReadOnlyPageObserverService/.test(value));
  } catch { /* Retain only obtained facts; no screen contents or permission writes. */ }
}
let migrationGate = { passed: false, reason: 'CHECK_FAILED', historicalMigration: null };
try { run(process.execPath, ['scripts/check-migration-safety.mjs']); migrationGate = { passed: true, reason: null, historicalMigration: null }; }
catch (error) {
  const detail = String(error.stderr ?? '') + String(error.stdout ?? '');
  migrationGate.reason = detail.includes('DESTRUCTIVE_MIGRATION_EVIDENCE_REQUIRED') ? 'RELEASE_EVIDENCE_REQUIRED' : 'CHECK_FAILED';
  migrationGate.historicalMigration = detail.includes('0083_runtime_authority_sources.sql') ? '0083_runtime_authority_sources.sql' : null;
}
const localPrerequisitesReady = services.every(service => service.ready) && device.connected && device.appInstalled && device.observerSystemEnabled && migrationGate.passed;
const report = { schemaVersion: 'v90-local-readiness.v1', commit, observedAt, completedAt: new Date().toISOString(),
  scope: 'Read-only current local prerequisites; not deployment, user consent, real resource closure or seven-day proof',
  services, device, migrationGate, localPrerequisitesReady, betaAcceptance: 'REAL_PENDING',
  pendingEvidence: ['NORMAL_USER_FIVE_PAGE_FLOW', 'USER_MEMORY_CONSENT_AND_CONSUMPTION', 'PHONE_OBSERVE_AND_USER_VERIFICATION',
    'THIRD_PARTY_METHOD_AND_ACTUAL_RESOURCE_COMPOSITION', 'SEVEN_DAYS_CONTINUOUS_OPERATION', 'MIGRATION_RELEASE_EVIDENCE'] };
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report, null, 2));
process.exitCode = localPrerequisitesReady ? 0 : 2;
