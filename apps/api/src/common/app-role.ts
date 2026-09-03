// 进程职责分离：模块化单体下，API / Execution Worker / Outbox Worker 可独立启动。
export type AppRole = 'api' | 'execution-worker' | 'outbox-worker';

const VALID_ROLES = new Set<AppRole>(['api', 'execution-worker', 'outbox-worker']);

export function currentAppRole(): AppRole | 'all' {
  const role = process.env.APP_ROLE;
  if (role === undefined || role === '') {
    // Development and tests may intentionally use the integrated process. Deployments
    // are rejected by shared configuration validation before any module starts.
    return 'all';
  }
  if (VALID_ROLES.has(role as AppRole)) return role as AppRole;
  throw new Error(`Invalid APP_ROLE: ${role}`);
}

// 指定 Worker 是否应在当前进程内运行。
export function workerEnabled(role: 'execution-worker' | 'outbox-worker'): boolean {
  const current = currentAppRole();
  return current === 'all' || current === role;
}
