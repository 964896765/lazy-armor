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

来源：[GitHub Actions Run #24](https://github.com/964896765/lazy-armor/actions/runs/33868047169)；[GitHub Actions Run #26](https://github.com/964896765/lazy-armor/actions/runs/33871515930)
