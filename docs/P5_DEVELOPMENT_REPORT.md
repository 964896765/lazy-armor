# 懒人装甲 P5 Development Report

## Status

`DEVELOPMENT COMPLETE`

`Current Stage = Final Integrated Audit`

P5 商业化主体能力已在统一主链与安全底座上完成代码闭环与集成验收。外部生产基础设施继续保留 `DEFERRED / PRODUCTION GATE`，不作为失败处理。

## COMPLETE

### Membership

- `membership_plans` / `user_memberships` 数据模型与 forward-only migration。

- Free / Plus 集中式权益目录（`EntitlementService` + `entitlement-catalog`）。

- Active Plan 数量限制，含并发激活串行化，杜绝 Free 限额竞态。

- Free → Plus → Free 降级边界：降级不删除、不暂停、不修改历史；超额时新计划禁止激活、暂停后禁止重新激活到超额。

- Permission revoke、Disconnect、Approval、Risk、Credential revoke、数据管理、Security Notification 永不因套餐或额度被阻断。

### Entitlement

- 集中式能力断言（`can` / `assertAllowed` / `getLimit`）。

- 安全能力永久绕开收费限制。

### Usage Metering

- `usage_events` append-only + 唯一 `usage_identity`。

- Logical Usage != Physical Attempt：Worker takeover、Outbox redelivery、Connector retry 均只计一次逻辑用量。

- 消费者视角用量输出不含 provider cost / retry 内部字段。

### Subscription Sandbox

- Sandbox checkout / cancel / webhook 主链。

- Checkout 并发幂等（requestId → 单一 provider checkout + 单一 subscription）。

- Cancellation 幂等（`subscription_cancellation_requests`，A/B/C/D 四类测试）。

- Webhook 签名、时间戳、eventId、payload hash、重复投递与 out-of-order 时序保护。

### Template Lifecycle

- Lifecycle Overlay 而非修改 Template 历史。

- suspended / deprecated 不影响已安装 Plan 与 PlanVersion hash / activeVersionId。

- Template Admin 操作不直接修改用户 Plan。

### Connector Contract

- 统一 Manifest 校验与 fail-closed 注册。

- SDK Compatibility 契约：同 Major 兼容升级可注册，跨 Major fail-closed。

### Cost Foundation

- Provider Cost 与 Billable Usage 严格分离。

- 并发预算守卫：剩余预算下两笔并发消费只放行一笔（`COST_BUDGET_EXCEEDED`）。

- 安全能力永不因 Cost Budget 被拦。

### Scale Foundation

- RateLimit Coordinator、Circuit Breaker、Backpressure、Cursor Pagination。

- 真进程多 Worker Scale Gate：2 个独立 Execution Worker + 重复 job 下，同一 Execution 只产生一次副作用。

### Backup / Restore P5 扩展

- `membership_plans` / `user_memberships` / `usage_events` / `subscription_customers` / `subscriptions` / `subscription_events` / `subscription_cancellation_requests` / `template_lifecycle_versions` / `cost_budgets` 全部纳入真实 `mysqldump` → restore → verify。

- Restore 后 Membership / Usage identity / Subscription event / Template lifecycle / Cost budget 不变化，`orphanRows = 0`，append-only 保持。

## DEFERRED / PRODUCTION GATE

以下继续保留 `DEFERRED`，不属于失败：

- 真实 Payment Provider

- 高风险付款

- 转账

- 自动购买

- 账户权限修改

- 正式 Android Signing

- Admin Enterprise Identity

- 尚未获得 Production Evidence 的 Provider

## Gate Evidence

- P5 专项测试：8 files / 48 tests 通过。

- P0 security + P4 回归：consumer journey、failure matrix、operations、observability 通过。

- Mobile 核心测试：8 files / 72 tests 通过。

- Monorepo typecheck：8 packages 通过。

- Connector SDK / Plan Schema 测试通过。

- Database backup-restore gate 通过（`orphanRows = 0`）。

