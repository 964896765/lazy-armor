# Batch 7 — Risk / Approval / Execution Integration

日期：2026-09-12。代码基线：本地 main@83010be（Batch 6），保留 7f0cb36 之后全部成熟主链。

最终验收基线：main@101a326（已核对 origin/main 一致）。沿用已入库的 Batch 7/8 实现，仅前向修复与完成门禁。

状态：已完成；最终 Full API / monorepo 门禁通过。

## 实现

- ActionIntent 在 Execution 创建事务内生成，绑定唯一 Execution / PlanVersion / PlanAction；冻结 target、payload、payloadHash、desiredOutcome、sideEffectKey、四级风险输入与 intentHash。
- effectiveRisk = max(ActionDefinition / declared risk、Provider capability / manifest floor、Scenario floor、context elevation)。金额仍按显式 ActionDefinition 的金额字段解析为 minor units；Runtime 不调用 AI 判断风险。
- Immutable Approval Snapshot 固定 ActionIntent、PlanVersion、动作、Connection / Capability、输入摘要、金额 / 币种、风险、副作用键与有效期。决定审批、Runner 放行及出站前均执行相应校验；出站边界复用成熟 Approval Gate，重验审批或既有范围受限临时授权。无有效放行依据时明确阻断；R4 不支持临时授权，审批不能覆盖连接 / 权限 / 凭据 Guard。
- ActionAdapter 只适配现有 Runner，不增加 Execution Engine。新执行缺少意图、摘要变化、Adapter 绑定变化及解析能力失效均 fail-closed。
- resolved-executions 接受服务端已保存的 Resolver 决策 ID：重验当前 Manifest / Grant / Health / Reality / Freshness / Device / Data Boundary，绑定原选择，不自动切换 Provider。动作及上下文计算后的真实风险不得超过 Requirement 的 maxRisk；请求键重放不能修改意图输入。
- 历史 Execution 的 actionIntentId 与审批快照保持可空，沿用原有保护；不回填重写 PlanVersion、Execution 终态或 Audit。

## 数据与接口

- 0042_action_runtime_integration：action_intents、action_adapter_bindings、execution_steps 的可空绑定及 approval_requests 的快照 / 摘要。
- 0043_action_adapter_resolution：Adapter 绑定 Resolver 决策 ID / hash；已有 0042 不被事后改写。
- POST /api/plans/:id/resolved-executions。
- GET /api/action-intents/:id、GET /api/executions/:id/action-intents。
- 新表使用 restrictive FK；Migration 无 DROP / TRUNCATE。

## 验收覆盖

- action-runtime.spec：风险 floor、不合法风险、动作摘要重建、审批字段变更及过期。
- runtime-action-integration.spec：迁移结构、并发请求唯一执行 / 意图、API 鉴权与归属、绑定篡改零执行、审批快照篡改拒绝。
- runtime-verification-reconciliation.integration.spec：已验证隔离 Provider 的 Resolver → ActionIntent → Risk → Approval → Runner → Outbox → 对账全链。
- P0-7 原有 45 项副作用保障回归；独立 Worker 进程 / 租约恢复专项回归。
- runtime-productization-migration.integration.spec：迁移重放、精确源文件 checksum、历史可空绑定、restrictive FK / unique index。
- 最终 Full API：71 个文件通过、2 个文件按条件跳过；433 项通过、5 项按条件跳过。通过 monorepo 中实际执行的完整 API 套件验收，未使用单项测试代替全量回归。
- Monorepo Test：16/16 工作区任务成功；Typecheck：8/8 成功；Build：8/8 成功。
- Plan Schema：42 项通过；Connector SDK：31 项通过；Mobile：16 个文件、99 项通过，类型检查及现有 web export 构建通过。
- Migration Safety：45 个迁移文件通过，破坏性语句 0；Repository Hygiene：591 个跟踪文件通过；Production Data Truth 通过。
- 真实 MySQL DB / concurrency / API contract 和 Migration replay / checksum 测试均包含于完整 API 套件。

门禁命令：pnpm typecheck、pnpm build、pnpm test、pnpm migration:safety、pnpm repository:hygiene、pnpm data:truth。最终完整运行日志位于 .data/runtime-batch-7-8-monorepo-final.log；类型检查与构建日志分别为 .data/runtime-batch-7-8-typecheck.log、.data/runtime-batch-7-8-build.log。

## 边界

没有真实支付、发布、订单动作，没有使用生产 Secret。官方 Provider 骨架仍保持既有 TO_VERIFY_OFFICIAL 状态；测试 Manifest / Adapter / 证据只存在于隔离测试应用。Batch 8 已连续推进，未等待人工确认。

## 回归中修复

- 独立进程测试先完成 dist 构建再启动；H4 的测试专用审批 TTL 显式延长，避免进程冷启动耗尽 2 秒窗口。生产审批 TTL 不变。
- 新增出站检查最初误拦既有 R3 临时授权，改为复用原 Approval Gate，重新校验授权范围、有效期和撤销状态；未降低 R4 安全底线。修复后原 Safety 与 Batch 7/8 专项共 28 项通过。
