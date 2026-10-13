export type MysqlTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

const DEFAULT_DATABASE_URL = 'mysql://lazy_armor:lazy_armor_dev@127.0.0.1:3307/lazy_armor';
const DEFAULT_ADMIN_URL = 'mysql://root:local_root_only@127.0.0.1:3307/mysql';
const isolatedName = /^lazy_armor_(?:backup|restore)_test(?:_[a-f0-9]{8,32})?$/;
const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);

export function parseMysqlTarget(databaseUrl: string): MysqlTarget {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('BACKUP_RESTORE_INVALID_DATABASE_URL'); }
  let database: string;
  let user: string;
  let password: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch { throw new Error('BACKUP_RESTORE_INVALID_DATABASE_URL'); }
  const port = Number(url.port || '3306');
  if (url.protocol !== 'mysql:' || !url.hostname || !user || url.search || url.hash || port < 1 || port > 65535
    || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) throw new Error('BACKUP_RESTORE_INVALID_DATABASE_URL');
  return { host: url.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port, user, password, database };
}

export function assertIsolatedBackupDatabase(name: string) {
  if (name.length > 64 || !isolatedName.test(name)) throw new Error('BACKUP_RESTORE_DATABASE_NOT_ISOLATED');
}

/** Validate every destructive target before filesystem changes, connections or child processes. */
export function resolveBackupRestoreTargets(env: NodeJS.ProcessEnv) {
  const appEnv = env.APP_ENV ?? 'development';
  if (!['development', 'staging'].includes(appEnv) || env.NODE_ENV === 'production')
    throw new Error('BACKUP_RESTORE_ENVIRONMENT_FORBIDDEN');
  const databaseUrl = env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const adminDatabaseUrl = env.MYSQL_ADMIN_URL ?? DEFAULT_ADMIN_URL;
  const backupDatabase = env.BACKUP_TEST_DB ?? 'lazy_armor_backup_test';
  const restoreDatabase = env.RESTORE_TEST_DB ?? 'lazy_armor_restore_test';
  assertIsolatedBackupDatabase(backupDatabase);
  assertIsolatedBackupDatabase(restoreDatabase);
  const appTarget = parseMysqlTarget(databaseUrl);
  const adminTarget = parseMysqlTarget(adminDatabaseUrl);
  if (['mysql', 'information_schema', 'performance_schema', 'sys'].includes(appTarget.database.toLowerCase()))
    throw new Error('BACKUP_RESTORE_APPLICATION_DATABASE_FORBIDDEN');
  if (appTarget.host !== adminTarget.host || appTarget.port !== adminTarget.port)
    throw new Error('BACKUP_RESTORE_SERVER_MISMATCH');
  const endpoint = `${appTarget.host}:${appTarget.port}`;
  if (env.BACKUP_RESTORE_ALLOWED_TARGET && env.BACKUP_RESTORE_ALLOWED_TARGET !== endpoint)
    throw new Error('BACKUP_RESTORE_TARGET_NOT_ALLOWED');
  if (!localHosts.has(appTarget.host) && (appEnv !== 'staging' || env.BACKUP_RESTORE_ALLOWED_TARGET !== endpoint))
    throw new Error('BACKUP_RESTORE_TARGET_NOT_ALLOWED');
  const databases = [appTarget.database, adminTarget.database, backupDatabase, restoreDatabase].map(name => name.toLowerCase());
  if (new Set(databases).size !== databases.length) throw new Error('BACKUP_RESTORE_DATABASE_COLLISION');
  return { databaseUrl, adminDatabaseUrl, backupDatabase, restoreDatabase, appTarget, adminTarget };
}

/** Docker fallback may only use the same locally published server as the validated URL. */
export function assertBackupContainerEndpoint(target: MysqlTarget, ports: unknown) {
  if (!localHosts.has(target.host)) throw new Error('BACKUP_RESTORE_CONTAINER_TARGET_MISMATCH');
  const mappings = (ports as Record<string, unknown> | null)?.['3306/tcp'];
  if (!Array.isArray(mappings) || !mappings.some((mapping: { HostIp?: unknown; HostPort?: unknown }) =>
    mapping?.HostPort === String(target.port) && (target.host === '::1'
      ? ['::', '::1'].includes(String(mapping.HostIp))
      : target.host === 'localhost' ? ['0.0.0.0', '127.0.0.1', '::', '::1'].includes(String(mapping.HostIp))
        : ['0.0.0.0', '127.0.0.1'].includes(String(mapping.HostIp)))))
    throw new Error('BACKUP_RESTORE_CONTAINER_TARGET_MISMATCH');
}
