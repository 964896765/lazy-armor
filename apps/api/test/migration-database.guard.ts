// Migration replay is allowed only in the two explicitly provisioned isolated
// databases. Do not broaden this to arbitrary names containing "test".
export function assertMigrationTestDatabase(value: string | undefined): string {
  if (!value) throw new Error('Migration integration requires an isolated test database');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Migration integration requires a valid isolated test database URL'); }
  if (url.protocol !== 'mysql:' || !['/lazy_armor_test', '/lazy_armor_ci_test'].includes(url.pathname)) {
    throw new Error('Migration integration is restricted to the isolated test database');
  }
  return value;
}
