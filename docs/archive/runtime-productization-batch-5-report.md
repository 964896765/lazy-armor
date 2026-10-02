# Batch 5 — Strategy Runtime + Dependency Index 开发报告

状态：已完成

基线：`main@76567c2`

日期：2026-09-10

## 交付结果

- 8 个 `StrategyProfile` 已正式参与 `ScenarioPlanCompiler` 和运行时绑定，统一生成触发、条件、动作、关注级别、审批、验证与自动化上限；没有为领域或策略建立独立 Engine。
- 建立版本化 `Condition AST` 与 `Operator Registry`，支持 `EQ`、`NE`、`GT`、`GTE`、`LT`、`LTE`、`IN`、`NOT_IN`、`CONTAINS`、`EXISTS`、`CHANGED`、`CHANGED_BY`、`COUNT`、`WITHIN_WINDOW`、`ALL`、`ANY`、`NOT` 共 17 个确定性运算符。
- 建立 Truth Dependency Index，按精确主体、资源范围、用户聚合与定时依赖登记不可变 PlanVersion；Truth 变化只唤醒同一用户下当前激活版本的匹配依赖。
- Reality Pipeline 在提交新 TruthVersion 的同一事务内生成去重的策略唤醒项，保留既有 Candidate、Truth Version、Provenance 与并发机制。
- 条件决策持久化 schema/operator 版本、TruthVersion 输入、解析值、逐节点运算轨迹、最终结果、评估时间、决策哈希与 15 步生命周期追踪。
- 运行时评估只完成 Source、Trigger、Condition 等前置阶段；后续 Risk、Approval、Execution、Verification、Result、Reconciliation 和 Audit 明确交还既有主链，未复制执行副作用。

## 数据库与迁移

- `0040_strategy_runtime.sql` 新增 `strategy_runtime_bindings`、`truth_fact_dependencies`、`strategy_runtime_wakeups` 与 `strategy_runtime_decisions`。
- PlanVersion 与策略运行时哈希一一绑定；依赖项、TruthVersion 唤醒和条件决策均具有唯一约束，重复请求幂等，并发评估至多形成一个决策。
- 开发库与测试库均已完成前向迁移；迁移不含 `DROP` / `TRUNCATE`，未改变历史 PlanVersion、Execution、Approval、Outbox 或 Audit 的不可变语义。

## 安全与确定性边界

- 绑定前校验编译场景和运行时哈希，运行时版本或输入不一致时 fail-closed。
- Runtime 条件只由版本化 AST、运算符注册表和指定 TruthVersion 求值；AI 不参与布尔判断。
- 查询、绑定、唤醒与评估均限定用户边界，跨用户资源不可见。
- 未激活 Plan、历史 PlanVersion、触发模式不兼容或依赖范围不匹配时均不入队。
- 决策为 `false` 时 15 步追踪显式标记条件后步骤为跳过；决策为 `true` 时显式记录向现有 Risk / Approval / Execution 主链的交接原因。

## 并发与验证

- 8 个 Golden Scenario 覆盖全部 StrategyProfile 的编译、依赖与确定性求值；另有运算符注册表和嵌套 AST 测试。
- Batch 5 API / DB / Contract / Concurrency 专项 6 项通过，覆盖迁移、17 个运算符、并发绑定幂等、跨用户隔离、仅激活版本唤醒、Reality Pipeline 原子入队、并发单决策与 15 步追踪。
- Plan Schema：7 个测试文件、34 项通过。
- Mobile：97 项测试通过。
- Full API Test：64 个测试文件、408 项通过；2 个测试文件、5 项测试按环境条件跳过。
- Monorepo Test：16/16 个工作区任务成功。
- Migration safety、开发数据库迁移、测试数据库迁移、TypeScript typecheck：通过。

## 架构结论

本 Batch 把策略从目录元数据升级为可执行的确定性运行时，并用 Truth Dependency Index 控制现实变化的精准唤醒。所有满足条件的运行仍汇入 `Source → Trigger → Condition → Action → Risk → Approval → Execution → Result → Fallback → Audit` 唯一主链；未重写 Execution Engine，也未创建 Finance / Vehicle / Device 等领域专属引擎。
