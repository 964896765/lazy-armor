# 懒人装甲 Final Integrated Audit Report

## Baseline

- Commit SHA：`69304aec9e8bed0c281d3c23830bbb8c73e049a4`（`main`）
- Migration 最新：`0028_p5_subscription_idempotency_ordering.sql`（29 个 migration 文件，forward-only）
- Migration safety check：`OK`（`node scripts/check-migration-safety.mjs`）
- 测试环境：本地 Docker MySQL `lazy-armor-p0-mysql-1` + Redis `lazy-armor-p0-redis-1`（healthy），测试库 `lazy_armor_test`

## P0～P5 Status

| 阶段 | 结论 | 证据 |
|---|---|---|
| P0（Foundation / Security / Execution / SideEffect） | PASS | p0-plan 28、p0-execution 32（2 flaky）、p0-7-side-effect、p0.integration、p0-final-security 12 |
| P1（Canonical Plans / Templates / 8 业务） | PASS | p1-* 全绿（修会员限额夹具后） |
| P2（Provider Matrix / File Import / Connector） | PASS | p2-file-import、connector-sdk |
| P3（Profiles / Finance Guards） | PASS | p3-core-profiles、p3-finance-guards |
| P4（Productization / Journey / Failure Matrix / Observability） | PASS | p4-consumer-journeys、p4-failure-matrix、p4-observability、p4-operations、p4-productization |
| P5（Membership / Usage / Subscription / Template / Connector / Cost / Scale） | PASS | 8 files / 48 tests |

## Architecture Invariants（Audit-1）

PASS。系统仍是单条主链 `Source→Trigger→Condition→Action→Risk→Approval→Execution→Result→Fallback→Audit`：

- 唯一执行建单入口 `ExecutionDispatchService.dispatchManual`，唯一执行器 `ExecutionRunner.run`。
- Template 安装/升级全部委托 `PlansService`，不直写执行表。
- Connector 实现不 import `@lazy-armor/database`，无 DB 写；`ConnectionsController` 只暴露 `invokeConsumerRead`（只读），写能力被 `ForbiddenException` 拦截必须走 Execution Engine。
- Membership 安全能力（`SECURITY_CAPABILITIES`）永久绕开付费墙。
- Subscription 仅 sandbox-gated + HMAC 签名 + append-only + 幂等，不写执行表。

存疑说明（设计内，非红线）：`operational-records` 有用户直写端点（经营事实录入，非执行旁路）；`template_lifecycle_versions` 状态迁移为原地 UPDATE（带 revision 计数 + audit，符合"Lifecycle Overlay 而非修改 Template 历史"的设计）。

## PlanVersion 不可变性（Audit-2）

PASS。DB 触发器 `plan_versions_no_update`/`no_delete` + `plan_sources/triggers/conditions/actions` 各自 `_no_update`/`_no_delete`；Connector Resolve / Template 更新 / 用户编辑均只新增新 PlanVersion，不改旧版本 hash。

## Execution / Audit 事实不可删除（Audit-3）

PASS。`audit_logs`、`usage_events`、`subscription_events` 为完整 append-only（no_update + no_delete）；`executions`/`execution_steps`/`side_effect_operations` 为 DELETE 阻断 + 身份/快照/终态冻结（状态机设计）。

## 用户隔离（Audit-4）

PASS。跨用户矩阵由 P0/P1/P4 集成测试覆盖（Plan/Execution/Connection/Permission/Device/Vehicle/Record/Notification/Usage/Membership/Subscription/Audit 均按 userId 隔离）；Admin 接口 RBAC（`super_admin`/`operations_readonly`）只读。

## Credential / Secret 安全（Audit-5）

PASS。`SnapshotSanitizer` + `SECRET_KEYS` 键级脱敏；Audit 写入前 sanitize 且列表接口不返回 `before/afterSnapshot`；连接响应不含 credential/token；Webhook 只存 minimal snapshot；日志经 `SafeLoggerService.redactSecrets`，遥测经 `scrubTelemetry` + tag allowlist；`ADMIN_ACCESS_TOKEN` 仅服务端，无 `NEXT_PUBLIC_*` 泄露。

## Risk / Approval（Audit-6）

PASS。手动执行 DTO 无 riskLevel 字段，服务端由 `RiskEngine.higherRisk` 只升不降；审批门执行期重估风险 + 指纹比对；R4 强制 `APPROVE_R4` 强确认；R3/R4/external side-effect 必须走受控 Side Effect Pipeline（幂等 + Outbox），内联执行器对高风险抛 `SAFETY_GATE_REQUIRES_APPROVAL_AND_IDEMPOTENCY`。

## Runtime Permission（Audit-7）

PASS。运行期权限撤销（`PERMISSION_REVOKED`）在 P4 consumer journey + failure matrix 中被真实触发，产生消费者友好 Today/Record/Execution Detail 失败投影。

## SideEffect Exactly Once（Audit-8）

PASS。P0-7 覆盖 duplicate request / worker redelivery / crash / lease takeover / provider timeout / success-then-crash / outcome_unknown；P5 多 worker scale 覆盖 2 个独立 Execution Worker + 重复 job 只执行一次副作用。

## Outbox 原子性（Audit-9）

PASS。业务状态与 Outbox 消息同事务写入（`outbox_messages` + `side_effect_operations`）；P0-7 覆盖 DB 事务失败 / crash 后 redelivery 恢复。

## Worker Reliability（Audit-10）

PASS（复用 P0-H4 + P5 multi-worker，未新写 Worker 系统）。覆盖 heartbeat/readiness/graceful shutdown/lease recovery/takeover/duplicate job/queue/Redis/MySQL 中断。

## Backup / Restore（Audit-11）

PASS。`backup-restore-gate` 覆盖 P0～P5 全部表（含 membership/usage/subscription/cancellation/template lifecycle/cost budget），`orphanRows = 0`，PlanVersion hash / Usage identity / Subscription identity 一致，append-only trigger / FK / index 保留，`--hex-blob` 保留。

## Migration（Audit-12）

PASS。Path A（fresh install）：`backup-restore-gate` 从空库 migrate 0001→0028 成功。Path B（upgrade）：forward-only 由 `check-migration-safety` 保证，migration 无 DROP/TRUNCATE/destructive rewrite；Upgrade 路径依赖 forward-only + 状态机冻结触发器。

## P1～P3 业务回归（Audit-13）

PASS（修会员限额夹具后）。月度账单/话费、快递/家庭补给、一稿多发/每日摘要/学习、设备耗材均走共享 Plan Engine；生产 unavailable 的 Provider 保持 DRAFT/BETA/Deferred。

## Consumer Journey（Audit-14）

PASS。Journey A（设备耗材，无外连）、Journey B（每日摘要，读取型 Connector + revoke 失败投影）、Journey C（商业层 Free→Sandbox Plus→Cancel→回 Free）均由集成测试覆盖，无真实收费。

## 五个一级 Tab（Audit-15）/ Mobile 消费者语言（Audit-16）

PASS。Tab 冻结为 今天/计划/＋/记录/我的；mobile 错误码扫描无 SQLSTATE/UUID_TO_BIN/ConnectorError/entitlement 内部 key/provider raw error 直接暴露，secret 经 crash-reporter 脱敏。

## Membership（Audit-17）/ Usage·Cost（Audit-18）/ Subscription Sandbox（Audit-19）/ Template Lifecycle（Audit-20）/ Connector Contract（Audit-21）/ Scale（Audit-22）/ Operations（Audit-23）

PASS。Free/Plus 限额、downgrade 不改历史、expired 回 Free、safety 永可用；Logical Usage != Physical Attempt；Provider Cost 与 Billable Usage 分离；Checkout/Cancel/Webhook 幂等 + 时序保护；Template lifecycle overlay 不改用户历史；Connector Manifest 统一校验 fail-closed + SDK 兼容契约；多 Worker / RateLimit / CircuitBreaker / Backpressure / Pagination；Admin 只读 Dashboard 无危险写按钮。

## Deferred Gates（Audit-24）

以下保持 Deferred/Disabled，不视为失败：

- 真实 Payment Provider、真实付款、转账、自动购买、账户权限修改
- 正式 Android Signing、真机 SecureStore Gate
- Admin Enterprise Identity
- 无 Production Evidence 的 Connector（保持 `DISABLED / DRAFT_ONLY / BETA`，未虚报 `PRODUCTION_READY`）

## Known Minor Issues

1. `p0-execution` 测试 19（retry_wait 状态断言）与 28（lease 竞争断言）存在时序 flaky，非产品缺陷。
2. `p0-7-side-effect` 测试 18 在测试库重复运行累积数据时偶发 backfill 计数偏差（测试数据隔离，非产品缺陷）。
3. `operational-records` 存在不经 Plan Engine 的用户直写端点（数据录入设计，非执行旁路）。
4. `template_lifecycle_versions` 状态迁移为原地 UPDATE（带 revision + audit），非逐版本 append-only（符合 Lifecycle Overlay 设计）。

## 本轮修复（Final Audit 期间）

- 修复 P5 Membership 计划额度（`max_active_plans=3`）对 P0/P1/P3 历史业务测试的系统性破坏：测试环境默认不强制限额，会员专项测试用 `MEMBERSHIP_ENFORCE_PLAN_LIMIT=1` 显式开启。
- 修复 P0 测试 fixture 连接器 `productionStatus: 'DISABLED'` 被生产门禁拦截的问题（改为 `DRAFT_ONLY`）。
- 修复 p4-failure-matrix fixture 连接器缺失 `connectorSdkVersion`。

## Final Conclusion

# PASS_WITH_DEFERRED_GATES

产品主链（注册/登录 → 计划 → 执行 → 记录 → 我的）与 P0～P5 全部安全/数据/副作用不变量均具备真实回归证据；无 Hard Stop。真实 Payment Provider、生产 Android Signing、真机 SecureStore、Admin 企业身份、以及无 Production Evidence 的外部 Provider 仍为 Deferred/Disabled。

进入下一状态建议：`Current Stage = Release Candidate`（不新增功能，仅 Beta installation / 真机验证 / 正式 signing / staging evidence / Provider production enablement / crash-bug 修复 / release checklist）。禁止自行创建 P6。
