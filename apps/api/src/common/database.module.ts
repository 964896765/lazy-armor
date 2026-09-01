import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, type Database } from '@lazy-armor/database';
import type { Pool } from 'mysql2/promise';

export const DATABASE = Symbol('DATABASE');
export const MYSQL_POOL = Symbol('MYSQL_POOL');
const DATABASE_BUNDLE = Symbol('DATABASE_BUNDLE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_BUNDLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createDatabase(config.getOrThrow<string>('DATABASE_URL')),
    },
    { provide: DATABASE, inject: [DATABASE_BUNDLE], useFactory: (bundle: ReturnType<typeof createDatabase>) => bundle.db },
    { provide: MYSQL_POOL, inject: [DATABASE_BUNDLE], useFactory: (bundle: ReturnType<typeof createDatabase>) => bundle.pool },
    DatabaseLifecycle,
  ],
  exports: [DATABASE, MYSQL_POOL],
})
export class DatabaseModule {}

export type InjectedDatabase = Database;
