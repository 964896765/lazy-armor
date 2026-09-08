# Batch 2 — Scenario Foundation 开发报告

状态：已完成  
基线：`main@1a651c9`  
日期：2026-09-08

## 交付结果

- 19 个领域与 96 个 `ScenarioDefinition` 由共享 Registry 唯一驱动，全部具备 revision、Fact、Source、Strategy、Risk、Truth/Freshness/Conflict、Verification 与 Fallback 声明。
- 建立 55 个 `ResourceDefinition`、151 个 `FactSchemaDefinition` 和 8 个 `StrategyProfile`；业务代码不得自行创建同义领域模型或专属 Engine。
- 建立明确的 Readiness 状态机。当前 Generic Reality Pipeline 尚未启用时，目录覆盖不会被伪装成自动化能力。
- `ScenarioPlanCompiler` 只生成现有 `PlanDefinition` 合约的确定性草稿；执行资格继续由现有 Plan/Risk/Approval/Execution 主链控制。
- 新增 `/domains`、`/scenarios`、`/resources`、`/strategies` 查询接口及场景 Readiness、Compiler API。

## 数据库与迁移

- `0037_scenario_foundation.sql` 新增版本化 Resource、Fact、Strategy、Scenario 目录与用户 Readiness Snapshot 结构。
- Registry 启动同步校验同 key/revision 的内容哈希不可变；重复与并发同步保持幂等。
- 迁移不含 `DROP` / `TRUNCATE`，未修改历史 PlanVersion、Execution 或 Audit 记录。

## 验证

- Plan Schema 单元测试：15 项通过（含 96 场景完整性、引用完整性、fail-closed Readiness、Compiler 合约）。
- Batch 2 API / DB / Contract / Concurrency 专项：5 项通过。
- Migration safety 与开发、测试数据库迁移：通过。
- Monorepo typecheck：8/8 通过。
- Monorepo build：8/8 通过，含 Mobile Web export。
- Full monorepo test：16/16 tasks 通过；API 61 files / 392 tests 通过，2 files / 5 tests 按既有条件跳过。

## 架构约束

本 Batch 未新增 Finance/Vehicle/Device 等领域引擎，也未改写 Execution Engine。所有场景均编译回统一 Plan Schema；未具备真实 Fact、可用 Capability 或 Generic Pipeline 时保持 `CATALOG_ONLY` / `MANUAL_READY`，禁止 UI 宣称“可自动运行”。
