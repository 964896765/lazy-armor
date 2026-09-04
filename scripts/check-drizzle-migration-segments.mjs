import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const databaseDir = path.join(repoRoot, 'packages', 'database');
const migrationsFolder = path.join(databaseDir, 'drizzle');
const databaseRequire = createRequire(path.join(databaseDir, 'package.json'));
const { readMigrationFiles } = databaseRequire('drizzle-orm/migrator');

if (!existsSync(migrationsFolder)) throw new Error(`Drizzle migrations folder is missing: ${migrationsFolder}`);
const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'));
const migrations = readMigrationFiles({ migrationsFolder });
if (migrations.length !== journal.entries.length) throw new Error(`Drizzle migration reader mismatch: migrations=${migrations.length}, journal=${journal.entries.length}`);

for (let index = 0; index < migrations.length; index += 1) {
  const entry = journal.entries[index];
  const migration = migrations[index];
  if (migration.bps !== entry.breakpoints) throw new Error(`Drizzle breakpoints mismatch for ${entry.tag}`);
  for (const [segmentIndex, segment] of migration.sql.entries()) {
    const count = topLevelDdlCount(segment);
    if (count > 1) throw new Error(`Drizzle migration ${entry.tag} segment ${segmentIndex} contains ${count} top-level DDL statements; add statement-breakpoint before real MySQL execution.`);
  }
}

console.log(`Drizzle migration segmentation OK: ${migrations.length} files; 0032=${migrations[32]?.sql.length ?? 0} segments; 0034=${migrations[34]?.sql.length ?? 0} segments.`);

function topLevelDdlCount(sql) {
  const normalized = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  return (normalized.match(/(?:^|;)\s*(?:CREATE\s+(?:TABLE|TRIGGER|INDEX|DATABASE)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|DATABASE|INDEX|TRIGGER)\b|RENAME\s+TABLE\b|TRUNCATE(?:\s+TABLE)?\b)/gim) ?? []).length;
}
