import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const drizzleDir = path.join(repoRoot, 'packages', 'database', 'drizzle');
const journalPath = path.join(drizzleDir, 'meta', '_journal.json');

const migrationFiles = readdirSync(drizzleDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (migrationFiles.length === 0) {
  throw new Error('No migration files found.');
}

const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
const entries = Array.isArray(journal.entries) ? journal.entries : [];

if (entries.length !== migrationFiles.length) {
  throw new Error(`Migration count mismatch: journal=${entries.length}, files=${migrationFiles.length}`);
}

for (let index = 0; index < migrationFiles.length; index += 1) {
  const expectedPrefix = String(index).padStart(4, '0');
  const file = migrationFiles[index];
  if (!file.startsWith(expectedPrefix)) {
    throw new Error(`Migration sequence is not forward-only at index ${index}: ${file}`);
  }
  const entry = entries[index];
  const expectedTag = file.replace(/\.sql$/, '');
  if (!entry || entry.idx !== index || entry.tag !== expectedTag) {
    throw new Error(`Journal mismatch at index ${index}: expected ${expectedTag}, got ${JSON.stringify(entry)}`);
  }
}

const latest = migrationFiles[migrationFiles.length - 1];
console.log(`Migration safety OK: ${migrationFiles.length} files, latest=${latest}`);
