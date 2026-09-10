# Batch 6 — Capability Resolver 开发报告

状态：已完成

基线：`main@2e4f924`（已核对远端 main 一致）

日期：2026-09-10

## 交付

- Connector SDK 新增版本化 `CapabilityRequirement`、可信候选快照和纯函数 Resolver。需求声明能力键、资源、读写语义、字段、用途、最低现实证据等级、新鲜度、风险和费用上限，以及可选的排序偏好；无需指定 Provider。
- Hard Filter 同时校验官方能力、实现成熟度、连接及授权、健康、账号、设备、现实证据、新鲜度、风险、字段/用途边界、显式禁用和费用。未知费用不能作为免费能力，未来时间戳不能作为新鲜证据。
- 合格候选按可靠性、验证方式数量、新鲜度、延迟、成本、Provider 偏好、Source Mode 偏好的固定顺序排序；同分按稳定候选 ID 排序，不依赖数据库返回顺序。
- `ResolutionEvidenceService` 提供服务端 Adapter hooks，用于账号/设备证据、实际数据时间、现实等级、成本、延迟和可靠性。HTTP 调用者不能提交候选或伪造这些证据；hook 缺失或失败时保守阻断。
- `POST /api/capability-resolutions` 校验所属 PlanVersion，读取用户连接、Manifest、Grant、Health 和 hook 证据后持久化解析结果。`GET /api/capability-resolutions/:id` 返回用户自己的历史决策。
- 新增 `0041_capability_resolution.sql` 与共享数据库类型，保存完整需求、候选快照、Manifest revision/hash、过滤原因、分项排序分数、备用候选、决策哈希和评估时刻。决策与 Audit 在同一事务写入。
- `(user_id, request_key)` 唯一约束保证并发请求幂等；相同键不同输入返回 409，其他用户的 PlanVersion 或决策返回 404。

## 执行边界

解析结果是持久化的选择建议，`executionAuthorized=false`。本 Batch 不执行外部动作，既有 Plan / Risk / Approval / Execution 主链保持原有职责；接入该主链属于 Batch 7。

读取备用候选标记 `REVALIDATE_BEFORE_READ`；写入备用候选标记 `REQUIRES_OUTCOME_RECONCILIATION`，均不自动执行。写入超时不能据此切换 Provider 重做。

当前真实 Provider 的未核实官方能力继续保持 `TO_VERIFY_OFFICIAL`。真实数据新鲜度、账号类型或费用没有适配器证据时，API 返回 `BLOCKED`。成功选择由隔离测试的已验证 Manifest 和服务端 evidence hook 验证，不代表新增真实官方接入。具体 Provider evidence hooks 随后续 Provider 真接入批次提供。

## 验证

- Resolver 单元测试：18 项通过，包含 15 类拒绝场景、稳定排序、读写备用策略与 Provider 无关选择；Connector SDK 总计 31 项通过。
- API / DB / Migration / Contract / Concurrency 专项：4 项通过，覆盖新表、输入校验、认证、真实注册表阻断、测试候选成功、并发单决策/单审计、用户隔离、请求冲突和授权到期。
- Migration Safety：42 个迁移文件通过，破坏性语句 0；开发库与测试库前向迁移成功。
- Monorepo Typecheck：8/8 通过。
- Repository Hygiene 与 Production Data Truth 检查通过。
- Full API Test：65 个文件通过，412 项通过、5 项按条件跳过。
- Monorepo Test：16/16 工作区任务成功；Monorepo Build：8/8 成功（命中有效构建缓存）。Mobile 未修改，类型检查通过，测试复用有效缓存。

## 回归中修复

API 专项运行前重新构建 Connector SDK / Database，解决新增共享导出未进入 dist 的依赖加载错误。证据收集后的评估时间修正避免刚生成的证据被误判为未来数据。本地 Docker / Redis 已恢复，继续执行既有真实进程故障恢复回归。
