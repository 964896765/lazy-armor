import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { schema } from './schema';

export function createDatabase(databaseUrl: string) {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    timezone: 'Z',
    decimalNumbers: false,
  });
  return { pool, db: drizzle(pool, { schema, mode: 'default' }) };
}

export type Database = ReturnType<typeof createDatabase>['db'];
