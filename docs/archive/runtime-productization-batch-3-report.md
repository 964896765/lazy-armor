# Batch 3 — Reality Pipeline 开发报告

状态：已完成  
基线：`main@6fb641f`  
日期：2026-09-09

## 交付结果

- 建立统一 `SourceObservation → Parser → Normalizer → Dedupe → CandidateFact → Generic Truth` 管线；Transaction、Shipment 与 Connection Health 使用同一套确定性服务，不新增领域专属 Engine。
- 建立 4 个 Parser、3 个 Normalizer，以及 Dedupe、3 类 Freshness、Conflict Policy 的不可变版本 Registry。
- Observation 以用户、Provider 与外部事件身份幂等；同一身份携带不同 Payload 时 fail-closed，禁止静默覆盖证据。
- Candidate 使用规范化值哈希进行语义去重；只有用户确认后的 Candidate 才能成为 Truth。
- Generic Truth 继续复用现有 `truth_records` / `truth_record_versions` 的不可变版本机制，并增加 `truth_provenance`，完整关联 Observation、Candidate、Provider、Source Mode 与 Evidence Hash。
- 现有 Notification → billing transaction → Truth 入口已迁移为 `mobile-notification-billing.v1` 兼容 Adapter，保留既有资源键和值结构，不改写既有 Truth Consumer。
- 新增受保护的 Observation 写入 API，以及用户隔离的 Candidate 查询/确认/拒绝与 Truth 查询 API。

## 数据库与迁移

- `0038_reality_pipeline.sql` 新增 Adapter/Policy Registry、Source Observation、Candidate Fact 与 Truth Provenance 表。
- 仅将旧 `truth_records.source_receipt_id` 从必填放宽为可空，使非通知来源可进入同一 Truth Store；不删改任何已有数据。
- 迁移安全门新增精确的 `BINARY(16) NOT NULL → NULL` 放宽识别，其他 `MODIFY/CHANGE` 继续要求发布证据。
- 迁移不含 `DROP` / `TRUNCATE`，未修改 PlanVersion、Execution、Approval、Outbox 或 Audit 不可变语义。

## 并发与安全

- 三路相同 Observation 并发写入只生成一个 Observation 和一个 Candidate。
- 同一 Candidate 双路并发确认只生成一个 Truth、一个 Version 和一组 Provenance；数据库死锁仅在无外部副作用的短事务内有限重试。
- Observation 身份冲突、未知 Parser、无效金额/币种、非 Pending Candidate 与跨用户访问全部 fail-closed。
- Generic Truth 写入完成后继续进入现有 Audit；没有绕过 Risk、Approval 或 Execution 主链。

## 验证

- Plan Schema 单元测试：21 项通过，其中 Reality Pipeline 6 项。
- Batch 3 API / DB / Contract / Concurrency 专项：5 项通过。
- 旧通知账单 Truth Store 真实 MySQL 并发回归：通过，并验证 Generic Adapter 的 Observation、Candidate、Provenance 各唯一一条。
- Migration safety 与开发、测试数据库迁移：通过。
- Monorepo typecheck：8/8 通过。
- Monorepo build：8/8 通过，含 Mobile Web export。
- Full monorepo test：16/16 tasks 通过；API 62 files / 399 tests 通过，2 files / 5 tests 按既有条件跳过。

## 架构结论

本 Batch 把现实输入统一汇入现有 Truth Version 与 Audit，而非建立第二条业务主链。Observation 仍不是 Truth，Candidate 仍不是 Truth；只有带证据且完成确定性确认的版本才能被现有 Plan/Execution Consumer 使用。
