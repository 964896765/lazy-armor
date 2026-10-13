import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertBackupContainerEndpoint, parseMysqlTarget, resolveBackupRestoreTargets } from '../src/backup-restore-safety';

const effects = vi.hoisted(() => ({
  createPool: vi.fn(() => { throw new Error('UNEXPECTED_DATABASE_CONNECTION'); }),
  mkdirSync: vi.fn(() => { throw new Error('UNEXPECTED_FILESYSTEM_WRITE'); }),
  spawnSync: vi.fn(),
}));
vi.mock('mysql2/promise', () => ({ default: { createPool: effects.createPool } }));
vi.mock('node:fs', () => ({ default: { mkdirSync: effects.mkdirSync } }));
vi.mock('node:child_process', () => ({ spawnSync: effects.spawnSync }));
import { runBackupRestoreGate, verifyBackupContainer } from '../src/backup-restore-gate';

const valid = {
  APP_ENV: 'development', NODE_ENV: 'test',
  DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor',
  MYSQL_ADMIN_URL: 'mysql://admin:fixture@127.0.0.1:3307/mysql',
  BACKUP_TEST_DB: 'lazy_armor_backup_test', RESTORE_TEST_DB: 'lazy_armor_restore_test',
};
const unsafeConfigurations = [
  { BACKUP_TEST_DB: 'lazy_armor_latest' },
  { BACKUP_TEST_DB: 'customer_backup' },
  { BACKUP_TEST_DB: 'lazy_armor_backup_test_extra' },
  { BACKUP_TEST_DB: 'lazy_armor_backup_test`;DROP DATABASE lazy_armor;--' },
  { RESTORE_TEST_DB: 'mysql' },
  { RESTORE_TEST_DB: 'information_schema' },
  { RESTORE_TEST_DB: 'lazy_armor_backup_test' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor_backup_test' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/LAZY_ARMOR_BACKUP_TEST' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor_%62ackup_test' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/information_schema' },
  { MYSQL_ADMIN_URL: 'mysql://admin:fixture@127.0.0.1:3307/lazy_armor_restore_test' },
  { MYSQL_ADMIN_URL: 'mysql://admin:fixture@127.0.0.1:3311/mysql' },
  { MYSQL_ADMIN_URL: 'mysql://admin:fixture@other.example:3307/mysql' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor/extra' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor?socketPath=/tmp/mysql.sock' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:3307/lazy_armor#alternate' },
  { DATABASE_URL: 'mysql://fixture:fixture@127.0.0.1:0/lazy_armor', MYSQL_ADMIN_URL: 'mysql://admin:fixture@127.0.0.1:0/mysql' },
  { APP_ENV: 'production' },
  { APP_ENV: 'unknown' },
  { NODE_ENV: 'production' },
  { BACKUP_RESTORE_ALLOWED_TARGET: '127.0.0.1:3311' },
  { APP_ENV: 'staging', DATABASE_URL: 'mysql://fixture:fixture@db.example:3306/lazy_armor', MYSQL_ADMIN_URL: 'mysql://admin:fixture@db.example:3306/mysql' },
];

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('backup/restore target isolation', () => {
  it('keeps the current local and CI targets compatible and allows unique isolated names', () => {
    expect(resolveBackupRestoreTargets(valid)).toMatchObject({ backupDatabase: valid.BACKUP_TEST_DB, restoreDatabase: valid.RESTORE_TEST_DB });
    expect(resolveBackupRestoreTargets({ ...valid, DATABASE_URL: 'mysql://root:fixture@127.0.0.1:3306/lazy_armor_ci_test',
      MYSQL_ADMIN_URL: 'mysql://root:fixture@127.0.0.1:3306/mysql', BACKUP_TEST_DB: 'lazy_armor_backup_test_1234abcd',
      RESTORE_TEST_DB: 'lazy_armor_restore_test_5678abcd' }).appTarget.port).toBe(3306);
  });
  it('requires an exact non-production staging server for remote runs', () => {
    const staging = { ...valid, APP_ENV: 'staging', DATABASE_URL: 'mysql://fixture:fixture@db.example:3306/lazy_armor',
      MYSQL_ADMIN_URL: 'mysql://admin:fixture@db.example:3306/mysql', BACKUP_RESTORE_ALLOWED_TARGET: 'db.example:3306' };
    expect(resolveBackupRestoreTargets(staging).appTarget.host).toBe('db.example');
    expect(() => resolveBackupRestoreTargets({ ...staging, APP_ENV: 'development' })).toThrow('TARGET_NOT_ALLOWED');
    expect(() => resolveBackupRestoreTargets({ ...staging, APP_ENV: 'production' })).toThrow('ENVIRONMENT_FORBIDDEN');
  });
  it.each(unsafeConfigurations)('rejects unsafe entrypoint configuration before any side effect: %j', async (overrides) => {
    for (const [key, value] of Object.entries({ ...valid, ...overrides })) vi.stubEnv(key, value);
    vi.stubEnv('BACKUP_RESTORE_ALLOWED_TARGET', 'BACKUP_RESTORE_ALLOWED_TARGET' in overrides ? overrides.BACKUP_RESTORE_ALLOWED_TARGET : undefined);
    await expect(runBackupRestoreGate()).rejects.toThrow(/BACKUP_RESTORE_/);
    expect(effects.createPool).not.toHaveBeenCalled();
    expect(effects.mkdirSync).not.toHaveBeenCalled();
    expect(effects.spawnSync).not.toHaveBeenCalled();
  });
  it.each(['https://fixture:fixture@127.0.0.1/lazy_armor', 'mysql://127.0.0.1/lazy_armor',
    'mysql://fixture:fixture@127.0.0.1/%FF', 'not-a-url'])('refuses ambiguous URLs without exposing credentials', url => {
    expect(() => parseMysqlTarget(url)).toThrow('BACKUP_RESTORE_INVALID_DATABASE_URL');
  });
});

describe('Docker backup client target', () => {
  const target = parseMysqlTarget(valid.MYSQL_ADMIN_URL);
  it('accepts only the matching published local MySQL port', () => {
    expect(() => assertBackupContainerEndpoint(target, { '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3307' }] })).not.toThrow();
    for (const ports of [null, {}, { '3306/tcp': null }, { '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3311' }] },
      { '3306/tcp': [{ HostIp: '192.0.2.1', HostPort: '3307' }] }]) expect(() => assertBackupContainerEndpoint(target, ports)).toThrow('CONTAINER_TARGET_MISMATCH');
    expect(() => assertBackupContainerEndpoint({ ...target, host: 'db.example' }, { '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3307' }] })).toThrow('CONTAINER_TARGET_MISMATCH');
  });
  it('does not run a dump or restore when the Docker fallback points at another server', () => {
    effects.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ '3306/tcp': [{ HostIp: '0.0.0.0', HostPort: '3311' }] }) });
    expect(() => verifyBackupContainer(target)).toThrow('CONTAINER_TARGET_MISMATCH');
    expect(effects.spawnSync).toHaveBeenCalledTimes(1);
    expect(effects.spawnSync.mock.calls[0]?.[1]).toContain('inspect');
  });
});
