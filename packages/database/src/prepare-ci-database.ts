import mysql from 'mysql2/promise';

function ciConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname || '127.0.0.1',
      port: Number(url.port || '3306'),
      user: decodeURIComponent(url.username || 'root'),
      password: decodeURIComponent(url.password || ''),
      database: url.pathname.replace(/^\//, '') || 'lazy_armor_ci',
    };
  }
  return {
    host: process.env.CI_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.CI_DB_PORT ?? '3306'),
    user: process.env.CI_DB_USER ?? 'root',
    password: process.env.CI_DB_PASSWORD ?? '',
    database: process.env.CI_DB_NAME ?? 'lazy_armor_ci',
  };
}

async function main() {
  const connection = ciConnection();
  const db = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
  });
  try {
    await db.query(`CREATE DATABASE IF NOT EXISTS \`${connection.database}\``);
  } finally {
    await db.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
