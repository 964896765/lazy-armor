import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd();
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const violations = [];

const forbiddenPathPatterns = [
  { name: 'Android build artifact', expression: /^artifacts\/android\/.*\.(?:aab|apk|apks)$/i },
  { name: 'backup SQL artifact', expression: /^artifacts\/backup-restore\/.*\.sql$/i },
  { name: 'environment file', expression: /(?:^|\/)\.env(?:\..+)?$/i, allow: (file) => /\.env\.(?:example|staging\.example|production\.example)$/.test(file) },
  { name: 'signing key or keystore', expression: /(?:^|\/).+\.(?:keystore|jks|p12|pfx)$/i },
  { name: 'private key file', expression: /(?:^|\/)(?:id_rsa|id_ed25519|.*\.pem)$/i },
];

for (const file of tracked) {
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.expression.test(file) && !(pattern.allow?.(file))) violations.push(`${pattern.name}: ${file}`);
  }
}

const secretPatterns = [
  { name: 'private key material', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', expression: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub personal access token', expression: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'OpenAI-style API key', expression: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

for (const file of tracked) {
  const fullPath = path.join(repoRoot, file);
  let stats;
  try {
    stats = statSync(fullPath);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > 1_000_000) continue;
  const content = readFileSync(fullPath, 'utf8');
  for (const pattern of secretPatterns) {
    if (pattern.expression.test(content)) violations.push(`${pattern.name}: ${file}`);
  }
}

if (violations.length > 0) {
  throw new Error(`REPOSITORY_HYGIENE_FAILED:\n- ${violations.join('\n- ')}`);
}
console.log(`Repository hygiene OK: ${tracked.length} tracked files checked.`);
