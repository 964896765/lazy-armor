# Batch 6～8 — 远端 CI 收口

日期：2026-09-12。冻结完成基线：`b679250e75ac5528bcd913f463d151d1801bb6bf`。

最终远端验收：**FULL GREEN**，严格限定于 `main@311f4729777466d40957409f29854eaaee84bbf7` 的 [release-candidate-ci #63](https://github.com/964896765/lazy-armor/actions/runs/34688655512)。2026-09-12 11:18:16 UTC 整轮 completed / success，PR Fast Gate / RC Full Gate / Android Verification Artifact 均 completed / success。后续提交必须重新核实自身门禁，不能继承本标记。

## 基线与安全修复

- 初始工作区 clean，当前分支 main；已 fetch / push，GitHub main 与 b679250 一致。
- Batch 6～8 从此只允许 bugfix，不再改变 Resolver / Risk / Approval / Execution / Verification / Reconciliation 核心架构。
- 首次远端验收：[release-candidate-ci #61](https://github.com/964896765/lazy-armor/actions/runs/34687376538) 失败。Production Dependency Audit 检出 multer 2.2.0 的 3 项 HIGH；后续 Migration / MySQL 8.4 / Full API / Mobile / Android 均被跳过，不能计为通过。
- 安全修复：只将既有 pnpm override 的 multer 升至 2.3.0，并更新对应锁文件版本与 integrity，保留无关平台依赖元数据；未修改运行主链、历史迁移或不可变记录。
- 官方公告：[GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm)、[GHSA-qfvm-cv95-jqjf](https://github.com/advisories/GHSA-qfvm-cv95-jqjf)、[GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4)。修复版本均为 2.3.0。

## 当前门禁状态

- 官方 npm registry 下 frozen-lockfile install 通过。
- `pnpm audit --prod --audit-level=high --registry=https://registry.npmjs.org` 通过：No known vulnerabilities found。只对本次命令指定 registry，不改用户全局镜像配置。
- 本地 monorepo build：8/8 成功；typecheck / migration safety / repository hygiene / production data truth 通过。
- 本地完整 monorepo / Full API / 真实数据库并发回归通过：16/16 任务，API 72 文件通过、1 文件按条件跳过，434 项通过、4 项按条件跳过。
- 修复提交 `4f6bb61` 的 [远端 CI #62](https://github.com/964896765/lazy-armor/actions/runs/34688176216) 快速门禁通过，RC 的 MySQL 8.4 Migration / Backup-Restore 通过；完整 API 测试因迁移测试硬编码只接受本地库名而失败，CI 使用的 lazy_armor_ci_test 被错误拒绝。修复为显式接受 lazy_armor_test / lazy_armor_ci_test 两个既有隔离库，其他名称、错误协议和无效 URL 仍在打开连接前拒绝；新增安全边界单元回归。未修改任何历史迁移源文件或 ledger。
- `311f4729777466d40957409f29854eaaee84bbf7` 的 [远端 CI #63](https://github.com/964896765/lazy-armor/actions/runs/34688655512)：PR Fast Gate、RC Full Gate、Android Verification Artifact 全部成功，整轮远端 CI 已完成。
- 远端 RC：Production Dependency Audit 无已知漏洞；MySQL 8.4.11；45 个迁移通过、破坏性语句 0；备份/恢复通过；Full API 73 文件通过、1 文件按条件跳过，445 项通过、6 项按条件跳过；monorepo test 16/16、build 8/8；Mobile 16 文件、99 项测试通过。
- 本地第二次完整回归：Full API 73 文件通过、1 文件按条件跳过，447 项通过、4 项按条件跳过；monorepo 16/16 成功。最新日志：`.data/batch-6-8-ci-migration-fix-monorepo.log`。Migration 安全边界专项：2 文件、15 项通过，日志 `.data/batch-6-8-ci-migration-fix.log`。
- MySQL 8.4 migration evidence 已上传，artifact ID `10296226987`，名称 `mysql84-migration-evidence-311f4729777466d40957409f29854eaaee84bbf7`，digest `sha256:114c300ea88b94a66b15d2e8f2d912c3592134bd58ca43945d54e2a921f58b02`。
- Android debug-signed verification AAB 与 metadata 已上传：artifact ID `10297252623`，名称 `android-verification-311f4729777466d40957409f29854eaaee84bbf7`，大小 70,080,475 字节，zip digest `sha256:b87c73376b83ef30854e0e5ef77d0dda26d86f9e1e6ff4e69cd3a2ef42b8ce20`。这是验证候选产物，不是真实 Beta/Staging、生产签名或手机实测完成声明。

本地日志：`.data/batch-6-8-ci-fix-build.log`、`.data/batch-6-8-ci-fix-typecheck.log`、`.data/batch-6-8-ci-fix-migration.log`、`.data/batch-6-8-ci-fix-monorepo.log`。

## 后续执行约束

远端完整收口后，按用户 2026-09-12 修订顺序连续执行 Provider Runtime Common Layer → Gmail → Google Calendar → GitHub → Notion → Cross-Provider Journeys，随后 Batch 10～14；不得用模拟 Provider 的通过替代真实平台验收。普通工程失败定位、修复、回归、继续；仅总规划 Hard Stop 暂停。
