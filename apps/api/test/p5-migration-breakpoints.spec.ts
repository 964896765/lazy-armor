import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const workspaces: string[] = [];

afterEach(() => { for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true }); });

function runFixture(sql: string, breakpoints = true) {
  const root = mkdtempSync(path.join(tmpdir(), 'lazy-armor-migration-breakpoints-'));
  workspaces.push(root);
  const migrationRoot = path.join(root, 'drizzle');
  mkdirSync(path.join(migrationRoot, 'meta'), { recursive: true });
  writeFileSync(path.join(migrationRoot, '0000_two_statements.sql'), sql);
  writeFileSync(path.join(migrationRoot, 'meta', '_journal.json'), JSON.stringify({ entries: [{ idx: 0, tag: '0000_two_statements', when: 0, breakpoints }] }));
  writeFileSync(path.join(root, 'baseline.json'), JSON.stringify({ legacyImmutableExceptions: {} }));
  return () => execFileSync('node', ['scripts/check-migration-safety.mjs'], { cwd: repoRoot, env: { ...process.env, MIGRATION_ROOT: migrationRoot, MIGRATION_JOURNAL: path.join(migrationRoot, 'meta', '_journal.json'), MIGRATION_SAFETY_BASELINE: path.join(root, 'baseline.json') }, encoding: 'utf8', stdio: 'pipe' });
}

describe('Drizzle migration statement-breakpoint gate', () => {
  it('fails closed when a breakpoints-enabled migration has multiple SQL statements but no delimiters', () => {
    const run = runFixture('CREATE TABLE alpha (id INT);\nCREATE TABLE beta (id INT);\n');
    expect(run).toThrow(/contains 2 top-level DDL statements but 0 Drizzle statement breakpoints; requires at least 1/);
  });

  it('allows a breakpoints-enabled multi-statement migration only when each statement is delimited', () => {
    const run = runFixture('CREATE TABLE alpha (id INT);\n--> statement-breakpoint\nCREATE TABLE beta (id INT);\n');
    expect(run()).toContain('Migration safety OK: 1 files');
  });

  it('does not miscount semicolons inside a trigger body as top-level DDL statements', () => {
    const run = runFixture("CREATE TRIGGER example BEFORE UPDATE ON alpha FOR EACH ROW BEGIN IF NEW.id > 0 THEN SET NEW.id = NEW.id; END IF; END;\n");
    expect(run()).toContain('Migration safety OK: 1 files');
  });

  it('rejects breakpoint markers if the matching journal entry disables them', () => {
    const run = runFixture('CREATE TABLE alpha (id INT);\n--> statement-breakpoint\nCREATE TABLE beta (id INT);\n', false);
    expect(run).toThrow(/contains statement breakpoints but its journal entry does not enable breakpoints/);
  });
});
