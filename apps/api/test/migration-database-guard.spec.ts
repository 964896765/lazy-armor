import { describe, expect, it } from 'vitest';
import { assertMigrationTestDatabase } from './migration-database.guard';

describe('migration replay database boundary', () => {
  it.each(['lazy_armor_test', 'lazy_armor_ci_test'])('accepts the explicitly provisioned %s database', (name) => {
    const url = `mysql://fixture:fixture@127.0.0.1:3307/${name}`;
    expect(assertMigrationTestDatabase(url)).toBe(url);
  });
  it.each([
    undefined, '', 'not-a-url', 'mysql://localhost/lazy_armor',
    'mysql://localhost/lazy_armor_production', 'mysql://localhost/lazy_armor_test_backup',
    'mysql://localhost/production_test', 'mysql://localhost/lazy_armor_ci_test/extra',
    'mysql://localhost/LAZY_ARMOR_TEST', 'postgres://localhost/lazy_armor_test',
  ])('rejects invalid or non-allowlisted targets before opening a connection (%s)', (url) => {
    expect(() => assertMigrationTestDatabase(url)).toThrow(/Migration integration/);
  });
  it('never includes URL credentials in boundary errors', () => {
    const url = 'mysql://private-user:private-password@localhost/production';
    try { assertMigrationTestDatabase(url); throw new Error('expected rejection'); }
    catch (error) { expect(String(error)).not.toContain('private-'); }
  });
});
