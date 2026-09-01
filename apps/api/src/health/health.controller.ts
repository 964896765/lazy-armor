import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { Public } from '../common/auth-context';
import { MYSQL_POOL } from '../common/database.module';
import { QueueService } from '../infrastructure/queue.service';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from '../credentials/credential-provider';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(MYSQL_POOL) private readonly pool: Pool,
    private readonly queue: QueueService,
    @Inject(CREDENTIAL_PROVIDER) private readonly credentials: CredentialProvider,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  // liveness：仅表示进程存活。
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  // readiness：MySQL + Redis/BullMQ + Credential Provider 全就绪才返回 ready。
  @Public()
  @Get()
  async health() {
    await this.pool.query('SELECT 1');
    const queue = await this.queue.health();
    const credential = await this.credentials.health();
    const ready = queue.bullmq === 'ready' && credential.status === 'ok';
    return { status: ready ? 'ok' : 'degraded', mysql: 'ready', credential: credential.provider, ...queue };
  }

  // 基础运营指标（无用户数据标签）。
  @Public()
  @Get('metrics')
  async metrics() {
    return this.diagnostics.snapshot();
  }
}
