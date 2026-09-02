import fs from 'node:fs';
import path from 'node:path';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDatabase } from './client';

function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (value) return value;
  const envFile = path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(envFile)) throw new Error('DATABASE_URL is required');
  const matched = fs
    .readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('DATABASE_URL='));
  const fallback = matched?.slice('DATABASE_URL='.length).trim();
  if (!fallback) throw new Error('DATABASE_URL is required');
  return fallback;
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
