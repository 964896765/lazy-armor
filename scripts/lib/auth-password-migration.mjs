// Aggregate-only audit. Never returns hashes, credentials, emails or user IDs.
export async function auditPasswordCredentialMigration(connection) {
 await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
 await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
 try {
  const [table]=await connection.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='password_credentials'");
  const expanded=Number(table[0].n)===1;
  const [legacy]=await connection.query('SELECT COUNT(*) AS n,COUNT(DISTINCT user_id) AS users FROM auth_identities');
  const [multiple]=await connection.query('SELECT COUNT(*) AS n FROM (SELECT user_id FROM auth_identities GROUP BY user_id HAVING COUNT(*)>1) AS multi');
  const [invalid]=await connection.query("SELECT COUNT(*) AS n FROM auth_identities WHERE NOT REGEXP_LIKE(password_hash,'^[$]2[aby][$](0[4-9]|[12][0-9]|3[01])[$][./A-Za-z0-9]{53}$','c')");
  const [noncanonical]=await connection.query('SELECT COUNT(*) AS n FROM auth_identities WHERE BINARY email<>BINARY LOWER(TRIM(email))');
  const [owners]=await connection.query("SELECT COUNT(*) AS n FROM auth_identities a JOIN login_identifiers l ON l.kind='email' AND l.identifier=LOWER(TRIM(a.email)) WHERE l.user_id<>a.user_id");
  let mirrored=0,missing=Number(legacy[0].users),mismatch=0,modernOnly=0,invalidModern=0;
  if(expanded){
   const [present]=await connection.query('SELECT COUNT(*) AS n FROM password_credentials');mirrored=Number(present[0].n);
   const [absent]=await connection.query('SELECT COUNT(DISTINCT a.user_id) AS n FROM auth_identities a LEFT JOIN password_credentials p ON p.user_id=a.user_id WHERE p.user_id IS NULL');missing=Number(absent[0].n);
   const [different]=await connection.query('SELECT COUNT(*) AS n FROM auth_identities a JOIN password_credentials p ON p.user_id=a.user_id WHERE BINARY p.password_hash<>BINARY a.password_hash OR p.source_legacy_identity_id IS NULL OR p.source_legacy_identity_id<>a.id');mismatch=Number(different[0].n);
   const [only]=await connection.query('SELECT COUNT(*) AS n FROM password_credentials p WHERE NOT EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id=p.user_id)');modernOnly=Number(only[0].n);
   const [bad]=await connection.query("SELECT COUNT(*) AS n FROM password_credentials WHERE BINARY algorithm<>BINARY 'bcrypt' OR version<1 OR NOT REGEXP_LIKE(password_hash,'^[$]2[aby][$](0[4-9]|[12][0-9]|3[01])[$][./A-Za-z0-9]{53}$','c') OR JSON_EXTRACT(parameters_json,'$.cost') IS NULL OR JSON_EXTRACT(parameters_json,'$.cost')<>CAST(SUBSTRING(password_hash,5,2) AS UNSIGNED)");invalidModern=Number(bad[0].n);
  }
  const blockers={multipleLegacyPasswords:Number(multiple[0].n),unsupportedLegacyHashes:Number(invalid[0].n),noncanonicalLegacyEmails:Number(noncanonical[0].n),identifierOwnerConflicts:Number(owners[0].n),mirrorMismatches:mismatch,unsupportedModernCredentials:invalidModern,modernOnlyUsers:modernOnly};
  const clean=Object.values(blockers).every(n=>n===0);
  return {expanded,legacyRows:Number(legacy[0].n),legacyUsers:Number(legacy[0].users),mirroredUsers:mirrored,missingUsers:missing,blockers,canBackfill:expanded&&clean,readyForUnified:expanded&&clean&&missing===0};
 } finally {await connection.rollback();}
}
