import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const drizzleDir = resolveFromRoot(process.env.MIGRATION_ROOT ?? 'packages/database/drizzle');
const journalPath = resolveFromRoot(process.env.MIGRATION_JOURNAL ?? path.join(path.relative(repoRoot, drizzleDir), 'meta', '_journal.json'));
const baselinePath = resolveFromRoot(process.env.MIGRATION_SAFETY_BASELINE ?? 'scripts/migration-safety-baseline.json');
const evidencePath = process.env.MIGRATION_SAFETY_EVIDENCE_PATH ? resolveFromRoot(process.env.MIGRATION_SAFETY_EVIDENCE_PATH) : undefined;

const migrationFiles = readdirSync(drizzleDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) throw new Error('No migration files found.');
if (!existsSync(journalPath)) throw new Error(`Migration journal is missing: ${journalPath}`);
if (!existsSync(baselinePath)) throw new Error(`Migration safety baseline is missing: ${baselinePath}`);

const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const entries = Array.isArray(journal.entries) ? journal.entries : [];
if (entries.length !== migrationFiles.length) {
  throw new Error(`Migration count mismatch: journal=${entries.length}, files=${migrationFiles.length}`);
}

for (let index = 0; index < migrationFiles.length; index += 1) {
  const expectedPrefix = String(index).padStart(4, '0');
  const file = migrationFiles[index];
  if (!file.startsWith(expectedPrefix)) throw new Error(`Migration sequence is not forward-only at index ${index}: ${file}`);
  const entry = entries[index];
  const expectedTag = file.replace(/\.sql$/, '');
  if (!entry || entry.idx !== index || entry.tag !== expectedTag) {
    throw new Error(`Journal mismatch at index ${index}: expected ${expectedTag}, got ${JSON.stringify(entry)}`);
  }
  validateStatementBreakpoints(file, readFileSync(path.join(drizzleDir, file), 'utf8'), entry);
}

const baseline = readJson(baselinePath, 'migration safety baseline');
const legacyExceptions = baseline.legacyImmutableExceptions ?? {};
const riskyMigrations = [];

for (const file of migrationFiles) {
  const fullPath = path.join(drizzleDir, file);
  const sql = readFileSync(fullPath, 'utf8');
  const findings = findDestructiveStatements(sql);
  if (findings.length === 0) continue;

  const sha256 = digest(sql);
  if (legacyExceptions[file] === sha256) continue;
  if (legacyExceptions[file] && legacyExceptions[file] !== sha256) {
    throw new Error(`Immutable legacy migration changed: ${file}. Its destructive-SQL baseline hash no longer matches.`);
  }
  riskyMigrations.push({ file, sha256, findings });
}

if (riskyMigrations.length > 0) validateReleaseEvidence(riskyMigrations);
const latest = migrationFiles[migrationFiles.length - 1];
console.log(`Migration safety OK: ${migrationFiles.length} files, latest=${latest}, destructive=${riskyMigrations.length}`);

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.join(repoRoot, value);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${filePath}; ${(error instanceof Error ? error.message : String(error))}`);
  }
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateStatementBreakpoints(file, sql, entry) {
  const normalized = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*-->\s*statement-breakpoint\s*$/gm, ' ');
  const topLevelDdlCount = (normalized.match(/(?:^|;)\s*(?:CREATE\s+(?:TABLE|TRIGGER|INDEX|DATABASE)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|DATABASE|INDEX|TRIGGER)\b|RENAME\s+TABLE\b|TRUNCATE(?:\s+TABLE)?\b)/gim) ?? []).length;
  const markers = (sql.match(/^\s*-->\s*statement-breakpoint\s*$/gm) ?? []).length;
  if (markers > 0 && entry.breakpoints !== true) {
    throw new Error(`Migration ${file} contains statement breakpoints but its journal entry does not enable breakpoints.`);
  }
  if (entry.breakpoints === true && topLevelDdlCount > 1 && markers < topLevelDdlCount - 1) {
    throw new Error(`Migration ${file} contains ${topLevelDdlCount} top-level DDL statements but ${markers} Drizzle statement breakpoints; requires at least ${topLevelDdlCount - 1}.`);
  }
}

function findDestructiveStatements(sql) {
  const normalized = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const patterns = [
    ['DROP_TABLE_OR_DATABASE', /\bDROP\s+(?:TABLE|DATABASE)\b/i],
    ['TRUNCATE', /\bTRUNCATE(?:\s+TABLE)?\b/i],
    ['DELETE_FROM', /\bDELETE\s+FROM\b/i],
    ['RENAME_TABLE', /\bRENAME\s+TABLE\b/i],
    ['ALTER_DROP', /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i],
    ['ALTER_MODIFY_OR_CHANGE', /\bALTER\s+TABLE\b[\s\S]*?\b(?:MODIFY|CHANGE)\b/i],
  ];
  const findings = [];
  let offset = 0;
  for (const statement of normalized.split(';')) {
    for (const [kind, expression] of patterns) {
      if (expression.test(statement)) {
        const line = normalized.slice(0, offset).split('\n').length;
        findings.push({ kind, line });
      }
    }
    offset += statement.length + 1;
  }
  return findings;
}

function validateReleaseEvidence(riskyMigrations) {
  if (!evidencePath || !existsSync(evidencePath)) {
    throw new Error(formatEvidenceFailure('No release evidence file was supplied', riskyMigrations));
  }
  const evidence = readJson(evidencePath, 'migration release evidence');
  if (!['staging', 'production'].includes(evidence.environment)) {
    throw new Error(formatEvidenceFailure('Evidence environment must be staging or production', riskyMigrations));
  }
  if (typeof evidence.database !== 'string' || evidence.database.trim().length === 0 || /localhost|127\.0\.0\.1|::1/.test(evidence.database)) {
    throw new Error(formatEvidenceFailure('Evidence must identify a non-local database target', riskyMigrations));
  }
  const headSha = resolveHeadSha();
  if (typeof evidence.commitSha !== 'string' || evidence.commitSha !== headSha) {
    throw new Error(formatEvidenceFailure(`Evidence commitSha must equal HEAD (${headSha})`, riskyMigrations));
  }
  const backup = evidence.backupRestoreGate;
  if (!backup || backup.status !== 'passed' || typeof backup.artifact !== 'string' || backup.artifact.trim().length === 0 || !backup.completedAt) {
    throw new Error(formatEvidenceFailure('Evidence must contain a passed backupRestoreGate with artifact and completedAt', riskyMigrations));
  }
  const approved = new Map((Array.isArray(evidence.approvedMigrations) ? evidence.approvedMigrations : [])
    .filter((entry) => entry && typeof entry.file === 'string' && typeof entry.sha256 === 'string')
    .map((entry) => [entry.file, entry.sha256]));
  const missing = riskyMigrations.filter((migration) => approved.get(migration.file) !== migration.sha256);
  if (missing.length > 0) {
    throw new Error(formatEvidenceFailure(`Evidence is missing an exact approved hash for ${missing.map((migration) => migration.file).join(', ')}`, riskyMigrations));
  }
}

function resolveHeadSha() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Unable to resolve HEAD commit for destructive migration evidence validation.');
  }
}

function formatEvidenceFailure(reason, migrations) {
  const details = migrations.map((migration) => `${migration.file} sha256=${migration.sha256} findings=${migration.findings.map((finding) => `${finding.kind}@${finding.line}`).join(',')}`).join('; ');
  return `DESTRUCTIVE_MIGRATION_EVIDENCE_REQUIRED: ${reason}. ${details}`;
}
