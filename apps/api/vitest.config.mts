import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['test/test-env.guard.ts'],
    // 集成套件会启动真实 Nest/Worker 进程并配置共享的 MySQL、Redis 与环境变量。
    // 这些资源由测试文件中的唯一数据隔离，而非支持文件级并行的全局进程状态。
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
