import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { WorkerProbe } from './worker-probe';

// 独立 Worker 进程：无 HTTP server，需显式保持事件循环存活并优雅退出。
// 优雅停机顺序由各服务的 OnApplicationShutdown 钩子保证（DB 连接 / BullMQ / Outbox claim 清理）。
export async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  await app.init();
  const probe = new WorkerProbe(app);
  await probe.listen();
  try { await waitForShutdownSignal(); }
  finally {
    await probe.close();
    await app.close();
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const keepAlive = setInterval(() => undefined, 1 << 30);
    const shutdown = () => {
      clearInterval(keepAlive);
      resolve();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  });
}
