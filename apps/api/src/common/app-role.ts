// 进程职责分离：模块化单体下，API / Execution Worker / Outbox Worker 可独立启动。
// APP_ROLE 缺省为 'all'（单体开发模式，同时运行 API 与两个 Worker）。
export type AppRole = 'api' | 'execution-worker' | 'outbox-worker';

export function currentAppRole(): AppRole | 'all' {
  const role = process.env.APP_ROLE;
  if (role === 'api' || role === 'execution-worker' || role === 'outbox-worker') return role;
  return 'all';
}

// 指定 Worker 是否应在当前进程内运行。
export function workerEnabled(role: 'execution-worker' | 'outbox-worker'): boolean {
  const current = currentAppRole();
  return current === 'all' || current === role;
}
