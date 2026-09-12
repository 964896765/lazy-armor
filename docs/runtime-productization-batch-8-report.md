# Batch 8 — Verification / Result / Reconciliation

日期：2026-09-12。阶段基线：main 的 Batch 6 后续前向扩展，与 Batch 7 连续开发。

状态：功能专项通过；最终 Full API / monorepo 验收进行中。

## 实现

- VerificationPolicyRegistry：不可变 key / revision、policy hash、显式 Provider / Capability 绑定；定义有界 timeout、最大回查次数、过期窗口和确定性字段谓词。
- Result model：SUCCEEDED / PARTIALLY_SUCCEEDED / FAILED / OUTCOME_UNKNOWN。缺失、pending、not_found、冲突或不支持的方法均不能被当作成功。
- verification_evidence：保存脱敏证据、方法、typed result、不可变 policy 身份、ActionIntent / operation / case provenance 和摘要；同一证据身份禁止覆盖不同内容。
- 0044_verification_reconciliation：verification_policies、verification_evidence、reconciliation_cases；唯一 operation case、唯一 operation evidence key、restrictive FK 和 due / lease index。
- Outbox 完成事务同步记录已知结果证据；未知结果事务原子保存 operation / step / outbox / case / evidence / audit。
- Reconciliation Worker 随独立 outbox-worker 角色运行，使用 FOR UPDATE SKIP LOCKED、独立 lease token 和过期接管。迟到 Worker 不能提交覆盖新租约。
- 自动回查仅调用显式支持的 lookupOperation，使用原有副作用键和当前权限 / 凭据校验；不调用 execute、不重入原 Action、不重新入队 Outbox。
- Provider 未有明确可用的只读验证策略时，进入 NEEDS_USER。Lookup 无确认结果时退避，达到上限 / 过期后停止自动回查。
- 不安全动作的派发权使用数据库 CAS；发现崩溃前已进入派发阶段时只回查。迟到成功响应追加证据，不覆盖历史未知 operation / Execution 终态。
- 对账收口独立更新 case 与追加 evidence / audit，保留历史 Execution 状态；Execution API 给出包含全部步骤的当前业务结果 projection。已跳过的步骤是已知未完成结果，不伪装成外部副作用未知；非外部步骤失败也参与部分成功的计算。

## 接口与消费者

- GET /api/verification-policies。
- GET /api/reconciliation-cases、GET /api/reconciliation-cases/:id。
- POST /api/reconciliation-cases/:id/recheck：只安排有界只读回查，闭合案例不重开。
- GET /api/executions/:id/verification；原 Execution 详情增加 resultState / reconciliationCases。
- Mobile 现有执行详情读取真实四态结果、回查进度与收口状态，提供只读回查按钮及错误提示。结果未知时明确禁止未经核实重复原动作；未另造静态产品页面。

## 真实闭环验收

runtime-verification-reconciliation.integration.spec 使用真实本地 HTTP / TCP Provider，不使用 mock timeout 代替网络断连：

1. Provider POST 提交副作用，故意不实现幂等去重，然后断开 TCP，不返回执行结果。
2. 多个 Outbox claim 竞争同一数据库消息，唯一获胜者派发；operation 进入 outcome_unknown，自动重发停止。
3. 多个 Reconciliation claim 竞争同一 case，唯一获胜者使用原 key 只读 GET 回查。
4. 保存 OUTCOME_UNKNOWN → SUCCEEDED 的不可变证据链，关闭 case；重跑 Worker / 请求回查 / 重投旧消息均不产生第二次 POST。
5. 验证副作用次数 = 1、正常闭环 GET 次数 = 1、case = 1、收口 Audit = 1；历史 operation 仍为 outcome_unknown，历史 Execution 仍为原终态。

另覆盖 lease 过期 / token fencing / takeover、partial result、pending 结果与有界停止、权限撤销、已派发不安全动作崩溃后的只读恢复、Resolver 绑定全链、鉴权 / 归属和不可变策略。reconciliation-result.spec 单独覆盖已跳过步骤、非外部步骤失败及历史未知结果的收口投影。

## 门禁

验证纯函数与 Registry unit、真实 MySQL DB / concurrency / API contract、Migration replay / checksum、Full API、monorepo test、8 包 typecheck / build、Mobile typecheck / 99 项测试均纳入验收；全量运行结果将在结束后补录。

## 边界

未宣称任何真实 Provider 已具备官方 API 或已产品化。真实账号接入属于后续 Provider Batch。当前网络故障闭环发生于隔离测试库及本地 Provider；不支付、不发布、不真实下单，不读取生产 Secret，不修改历史 PlanVersion / Audit。
