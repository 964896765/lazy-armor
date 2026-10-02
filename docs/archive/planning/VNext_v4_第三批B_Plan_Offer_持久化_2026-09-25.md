# VNext v4.0 第三批 B：Plan Offer 持久化交付记录

日期：2026-09-25  
分支：`fix/rc-full-gate-real-db-concurrency`

## 交付边界

本批在既有 Plan Engine 上增加创建合同，不建立第二套 Plan、Truth 或 Execution 引擎。旧 PlanVersion、96 个场景版本/hash、八种策略与十五步执行内核均未改写；十七步仍为外层只读投影。

新增接口：

- `POST /api/planning/offers/v2`：以 Scenario Contract V2、GoalSpec、ResourceSubject 和用户级 FactDemand 证据生成并持久化短期 Offer 快照。
- `POST /api/planning/offers/:offerId/choose`：使用幂等键确认 Offer，复验后原子创建既有 Plan/PlanVersion、Strategy Binding 和创建合同。

## 事务与权威性

`PlansService.createInTransaction` 与 `StrategyRuntimeService.bindInTransaction` 接受调用方事务执行器。确认流程在一个 MySQL 事务内完成：

1. `SELECT ... FOR UPDATE` 锁定用户所属 Offer；
2. 检查 AVAILABLE/EXPIRED/INVALIDATED/CHOSEN 状态；
3. 锁定并复核已选择的 connection 或 device-app/trusted-device/heartbeat；
4. 创建 Plan 与不可变 PlanVersion；
5. 写入 Strategy Binding 和 Fact dependencies；
6. 写入 `plan_creation_contracts`；
7. 将 Offer 置为 CHOSEN。

任一步异常全部回滚。外部 Provider 网络调用不会发生在事务锁内；事务外解析结果以十分钟 Offer TTL、合同 hash、计划定义 hash、来源/授权/设备/Truth 版本的 `preconditionHash` 约束，执行前仍须由第四批再次校验。

## 数据模型

- `plan_offer_snapshots`：用户级不可变生成快照；`(user_id, offer_key)` 唯一，状态索引覆盖过期扫描。
- `plan_creation_contracts`：一对一关联 Offer、PlanVersion；Offer、PlanVersion、`(user_id,idempotency_key)` 均有唯一约束。
- 全部外键使用 `restrict`，防止历史权威记录被级联删除。
- 历史 PlanVersion 不回填虚假 GoalSpec/Offer；生命周期投影继续明确显示 legacy 缺失证据。

状态转换：`AVAILABLE -> CHOSEN | EXPIRED | INVALIDATED`；`UNAVAILABLE` 不可确认。已确认请求返回既有创建合同，客户端未收到成功响应时可安全重试。

## 金标准场景

`daily_life.delivery@2` 已贯通：真实用户管理的 shipment subject → FactDemand → 当前用户授权且在线的菜鸟通知读取来源 → DRAFT_ELIGIBLE Offer → 确认时复验 → PlanVersion → SILENT_FOLLOW_UP Strategy Binding → 创建合同 → 17 步证据投影。

这里验证的是确定性本地测试环境与真实用户级数据库证据，不等同于菜鸟官方平台、远端 CI 或真机业务闭环。

## 测试记录

已覆盖：用户隔离、授权撤销、设备离线、Offer 过期、重复确认、双请求并发确认、成功响应丢失重试、Strategy Binding 注入失败、Plan 创建后的事务回滚、PlanVersion/Binding/合同单实例、生命周期证据投影、迁移安全与迁移重复运行。

真实平台、远端 CI、真机执行：本批未运行，明确记为跳过，不将本地测试等同于上述验收。
