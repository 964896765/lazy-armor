# Batch 7 — Risk / Approval / Execution Integration

日期：2026-09-12。代码基线：本地 main@83010be（Batch 6），保留 7f0cb36 之后全部成熟主链。

状态：功能专项通过；最终 Full API / monorepo 验收进行中。

## 实现

- ActionIntent 在 Execution 创建事务内生成，绑定唯一 Execution / PlanVersion / PlanAction；冻结 target、payload、payloadHash、desiredOutcome、sideEffectKey、四级风险输入与 intentHash。
- effectiveRisk = max(ActionDefinition / declared risk、Provider capability / manifest floor、Scenario floor、context elevation)。金额仍按显式 ActionDefinition 的金额字段解析为 minor units；Runtime 不调用 AI 判断风险。
- Immutable Approval Snapshot 固定 ActionIntent、PlanVersion、动作、Connection / Capability、输入摘要、金额 / 币种、风险、副作用键与有效期。决定审批、Runner 放行及出站前均执行相应校验；需要审批但未批准的动作在出站边界被明确阻断。审批不能覆盖连接 / 权限 / 凭据 Guard。
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
- 最终全量门禁结果在验收结束后补录，不将单项编译或专项测试代替全量验收。

## 边界

没有真实支付、发布、订单动作，没有使用生产 Secret。官方 Provider 骨架仍保持既有 TO_VERIFY_OFFICIAL 状态；测试 Manifest / Adapter / 证据只存在于隔离测试应用。Batch 8 已连续推进，未等待人工确认。
