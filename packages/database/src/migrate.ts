import path from 'node:path';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDatabase } from './client';

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required');
  return value;
}

async function main() {
  const { db, pool } = createDatabase(getDatabaseUrl());
  try {
    await migrate(db, { migrationsFolder: path.resolve(__dirname, '../drizzle') });
    process.stdout.write('Database migrations completed.\n');
  } finally {
    await pool.end();
  }
}

void main();
