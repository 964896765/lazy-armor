# CI #24 公开运行证据

> 采集时间：2026-09-04（公开 GitHub Actions 摘要页只读访问）

| 字段 | 公开可验证值 |
|---|---|
| 工作流 | `release-candidate-ci` |
| 运行编号 | `#24` |
| 运行 ID | `33868047169` |
| 提交 | `b45172cd1f12722e2b265d3b05fef4fef7a7aede` |
| 分支 | `main` |
| 触发 | push，2026-09-04 11:27 |
| 总耗时 | 5 分 7 秒 |
| 总结状态 | `failure` |
| 已失败任务 | `PR Fast Gate`，5 分 3 秒，退出码 1 |
| 后续任务 | `RC Full Gate` 与 `Android Verification Artifact` 未运行 |
| 工件 | 无 |

公开摘要只提供 PR Fast Gate 的退出码，运行日志页面要求登录。因此，**CI #24 不是 MySQL 8.4 迁移、备份恢复、Truth Store 真实并发或 Android 候选包的通过证据**。公开页面另提示被锁定 Action 的 Node 20 运行时弃用警告；该警告不是已确认的失败根因，未获得完整日志前不得据此修改工作流。

## 继续取证所需操作

应以具有仓库 Actions 日志读取权限的 GitHub 会话访问该运行，确定失败步骤和完整日志；修复并推送后，新的运行必须至少产出下列证据才可关闭数据库门槛：

1. `db:rc-integration` 的 MySQL 8.4、迁移、备份恢复通过日志；
2. `p5-truth-store-concurrency.integration.spec.ts` 在 `RUN_REAL_DB_INTEGRATION=1` 下实际执行且通过的记录；
3. `mysql84-migration-evidence-<sha>` 工件；
4. 完整 RC Full Gate 成功结论。

## 重跑尝试 #2 状态

2026-09-04 11:58，已在 GitHub 已登录会话中选择 **Re-run failed jobs**。GitHub 公开运行页显示该次尝试已启动，`PR Fast Gate` 为 `in progress`，`RC Full Gate` 与 `Android Verification Artifact` 等待 Fast Gate 结果。

2026-09-04 11:59，尝试 #2 的 `PR Fast Gate` 在 1 分 25 秒后失败。Job Summary 显示 12 个测试文件中 11 个通过、1 个失败，85 个已执行测试均通过；失败发生在 `apps/mobile/src/plan-presenter.spec.ts` 加载 `@lazy-armor/plan-schema` 时，报错为 package entry (`main/module/exports`) 无法解析。因 Fast Gate 在移动端测试步骤停止，`RC Full Gate`、`Android Verification Artifact`、MySQL 8.4、迁移、备份恢复与真实并发均**未执行**，也未产生工件。该运行另有 Node 20 Action runtime 弃用警告，但不是已确认失败根因。

## 后续 CI #25 与 #26 根因记录

CI #25 已验证移动端在干净环境解析 `@lazy-armor/plan-schema` 入口的缺口；在测试前构建内部 API 依赖闭包后，CI #26 的该步骤、Mobile 90 项测试及 API 安全/设备/Truth Store 聚焦回归均通过。

CI #26 随后失败于 `p5-scale-multi-worker.integration.spec.ts`：子进程 `/live` 未在 20 秒内返回 HTTP 200。因此 Fast Gate 停止，MySQL 8.4 证据工件、RC Full Gate 与 Android 验证均被跳过。根因是该集成测试的父进程明确设为 `APP_ROLE=api`，而生成 Worker 子进程时继承了此角色；入口逻辑会尊重已声明角色，WorkerProbe 因不是 `execution-worker` 而拒绝启动。测试现已显式传递 `APP_ROLE=execution-worker`，这是测试进程角色隔离修复，不改变生产入口的显式部署角色策略。

## CI #27 根因与修复记录

CI #27 的 `PR Fast Gate` 已成功：内部 API 依赖闭包构建、移动端 90 项测试、API 安全/可信设备/Truth Store 回归均已放行。`RC Full Gate` 失败不是 MySQL 8.4 服务不可用，而是 `pnpm test` 经 Turbo 严格环境运行时未声明 `DATABASE_URL` 等必要输入，集成测试回落至开发机默认的 `127.0.0.1:3307` 并被拒绝连接；同时该任务先前只构建依赖而未构建被测 API 本身，令动态 `dist` 安全回归入口缺失。现已将必要环境列入 `globalEnv`，并令 `test` 同时依赖 `build` 与 `^build`。

同次运行中 `Android Verification Artifact` 在开始 Gradle 前失败：PowerShell 脚本只复制了仓库顶层目录，临时工作区没有 `apps\\mobile\\android`。复制逻辑现已改为递归复制，同时保留对 `.git`、环境文件、密钥与生成工件的排除。多 Worker 进程测试还发现父 API 角色会被 Worker 子进程继承，因此两个执行 Worker 测试均已显式使用 `APP_ROLE=execution-worker`。

## CI #29 首次真实数据库证据

CI #29 的 Fast Gate 已通过，且 RC Full Gate 已真实成功执行 `Prepare CI database` 和 `MySQL 8.4 migration and backup/restore evidence`。这首次提供了 MySQL 8.4、全量迁移、前向迁移和备份恢复的实际运行证据。随后完整测试因两个独立问题失败：一是 Truth Store 并发确认触发底层 mysql2 `ER_DUP_ENTRY`，但 Drizzle 包装错误未被幂等处理；二是历史 Worker 故障注入测试尝试 `docker compose` 管理 GitHub Actions service containers。前者已改为识别 `cause.code=ER_DUP_ENTRY` 并重读已提交完整事实；后者只在本地 Compose 运行，CI 保留真实 Worker/Redis/MySQL 正常路径。CI #29 因后续提交被并发策略取消，Android 工件未形成完成结论。

来源：[GitHub Actions Run #24](https://github.com/964896765/lazy-armor/actions/runs/33868047169)；[GitHub Actions Run #26](https://github.com/964896765/lazy-armor/actions/runs/33871515930)；[GitHub Actions Run #27](https://github.com/964896765/lazy-armor/actions/runs/33872113846)；[GitHub Actions Run #29](https://github.com/964896765/lazy-armor/actions/runs/33873822580)
