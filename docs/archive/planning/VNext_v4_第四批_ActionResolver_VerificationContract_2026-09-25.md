# VNext v4.0 第四批：ActionResolver + Verification Contract

日期：2026-09-25

## 结论

本批没有建立第二套 Execution、Risk、Approval、Verification 或 Reconciliation 引擎。实现继续使用现有权威链路：

`CapabilityResolver → ExecutionDispatch → ActionAdapter → RuntimeConnectionGuard → SideEffectCoordinator/Outbox → Verification → Reconciliation`

新增内容是可持久化、可校验的动作解析与验证合同快照，用于把创建执行时选中的渠道、风险依据和结果核验规则一直约束到真实副作用前及结果核验阶段。

## 实现

- `action_adapter_bindings` 增量保存 Action Resolution Contract 和 Verification Contract；历史行允许为空，保持原有执行兼容。
- Action Resolution Contract 固定 PlanVersion、ActionIntent/hash、适配器版本、连接、能力、Capability Resolution 决策、风险指纹和验证合同 hash。
- Verification Contract 固定 provider/capability、不可变 policy revision、policy hash 及完整策略快照。
- `ExecutionDispatchService` 在原执行创建事务中保存上述合同，不复制 Plan 或 Execution 创建逻辑。
- `ActionAdapter` 在外部动作前重新校验 ActionIntent、解析合同、验证合同、当前策略版本、Capability Resolution、风险和审批快照。
- `RuntimeConnectionGuard` 继续在副作用持久化前检查连接归属、撤销/过期、授权范围、Provider runtime 和生产门禁。
- `VerificationService` 对新执行使用冻结的 Verification Contract；历史执行继续使用原 registry 选择逻辑。
- Provider 响应不确定时继续进入 `OUTCOME_UNKNOWN`；Reconciliation 仅执行只读 lookup，不重新发送原副作用。

## 数据库

迁移：`0054_action_verification_contract.sql`

全部新增列为 nullable，历史 Action Adapter Binding 不回填虚假合同。迁移只增加列，无破坏性 DDL；主库与测试库均验证正向执行和重复运行。

## 验证矩阵

- 合同 hash、跨 capability 复用和篡改：共享合同单测覆盖。
- 并发重复 dispatch：数据库唯一约束保持单 Execution、单 ActionIntent、单 Binding。
- Verification Contract 被篡改：副作用前失败，step attempt 为 0，SideEffectOperation 为 0。
- 审批完成后授权撤销：副作用前复验失败，SideEffectOperation 为 0。
- 外部副作用已成功但网络响应丢失：进入 `OUTCOME_UNKNOWN`，只读 reconciliation 成功，真实副作用次数保持 1。
- lookup 期间授权撤销：不调用 Provider lookup，也不重放原副作用。
- 不安全副作用在持久化 dispatch checkpoint 后崩溃：恢复路径只执行 lookup。
- 历史记录：新合同为空时沿用既有完整性、风险、审批和连接守卫。

## 验收边界

本批验证使用本机 MySQL 和本地网络 Provider fixture，证明事务、并发、失败关闭和不重复副作用语义；不等同于远端 CI、生产 Provider 或真机平台验收。
