# VNext v4.0 Batch 7 C/D — 财务闭环与三金标准回归

日期：2026-09-26。C 基线：`46e655c`；D 验收增量待本记录对应提交。

## C：finance.accounting

- `finance.accounting@1`（V2-only）经统一 Compiler 生成既有 Plan / PlanVersion / Strategy Binding；不改写 96 个不可变场景或历史 hash。
- 编译结果使用 `finance.transaction` 的内部 Truth 来源，并复用 `classify → summarize → compare → notify → record`、ActionResolver、Execution、Verification 与 Consumer Outcome。
- Risk Engine 改为以统一场景定义解析 V2-only 绑定，同时保留 revision 失败关闭检查。
- 交易身份以 `provider → connection（如有）→ accountKey（优先）→ transactionId` 建立稳定命名空间；同一 Provider 连接的不同账户不会因相同 transactionId 合并。缺少稳定账户/连接身份时，transactionId 不触发合并，记录保留为独立候选，等待显式关联或核对证据。该规则防止错误合并，**不等于**已经实现跨平台交易去重。
- 报表按币种独立统计，不存在可信汇率事实时不相加。报告证据分别表达归类、周期汇总、核对、差异跟进和报告状态；核对差异不等同于欺诈结论。
- 文件导入继续只产生 Candidate；仅已验证 Truth 可参与账目执行，未开启转账、支付或其他资金操作。

## D：验收边界

确定性 MySQL 集成回归覆盖：快递 `daily_life.delivery`、耗材 `device.consumables`、账目 `finance.accounting` 复用同一 FactDemand / SourceResolver / Truth / Offer / PlanVersion / Strategy / ActionResolver / Execution / Verification / Consumer Outcome / Availability-Replan 路径；未为三个场景新增独立执行引擎。

- Offer 创建与选择均走现有重新解析和合同 hash 检查；并发确认、重复确认、回滚、授权撤销、设备离线、过期事实和 replacement Offer 由共享持久化 Offer 回归覆盖。
- 新交易先进入 Reality Pipeline Candidate，只有用户确认后的 Truth 能参与账目计划；更新的已验证事实使后续执行重新读取 Truth。事实过期只要求刷新，来源/授权/合同发生重大变化才要求重新确认；原 PlanVersion 与其审批快照不被静默改写。
- `finance.accounting@1` 为 V2-only；文件导入是本地用户授权文件的确定性处理，不是银行/支付 Provider 的真实验收。通知内容也只能形成候选，不能直接认定为真实交易。

本地确定性通过不代表：Android 真机通知/设备读取、官方支付/银行 Provider 授权或远端 CI 已验收。当前 `finance.accounting` Contract 仍标记 `DETERMINISTIC_SANDBOX`，生产资金操作保持关闭。

## 已执行门禁与结果

- Plan Schema 定向：`reality-pipeline.spec.ts`，**1 file / 14 passed / 0 failed / 0 skipped / exit 0**。
- API 定向 MySQL 集成：`b7-transaction-file-import`、`b7-finance-accounting-offer`，**2 files / 7 passed / 0 failed / 0 skipped / exit 0**。
- 既有三金标准组合回归（C 阶段）：**5 files / 25 passed / 0 failed / 0 skipped / exit 0**，包括 `daily_life.delivery` consumer journey、`device.consumables` FactDemand 与财务 Offer/执行/文件链。
- 运行环境：本机 Windows，Node `v20.19.4`、pnpm `9.12.0`，API 集成套件通过 `bootP2App` 使用隔离 MySQL 测试库；这是本地确定性数据库证据。
- 完整 `pnpm test`：**实际 pnpm/Turbo exit 1**（日志执行 8m57s；外层临时日志包装器错误地写出 `0`，不采用该值）。API 汇总为 **112 files passed / 1 failed / 4 skipped；841 tests passed / 4 failed / 51 skipped**。Turbo 汇总为 **15 successful / 16 total**，失败任务为 `@lazy-armor/api#test`。失败均在 `github-webhook.integration.spec.ts` 的既有 GitHub webhook 并发 handoff 组：3 个 500（期望 201）和 1 个 30 秒超时；不是本批 finance 定向套件。该全量结果来自含既有未提交执行/策略改动的工作区，不能作为干净 SHA 的通过证明。

## 未满足或独立保留的验收

- 未取得同 SHA 的远端 CI 结果。
- 未取得 Android 真机通知/分享/可信设备的数据读取验收。
- 未取得真实银行、支付或其他官方 Provider 的合法授权与实际读写验收；生产资金动作仍未开放。
- 跨平台交易的显式关联证据与人工核对闭环仍需后续真实来源验收，不能由命名空间或 AI 推断代替。
- 本地完整门禁尚未通过：必须先在隔离、可复现工作区定位 GitHub webhook 并发回归；本批不会修改或提交当前用户持有的未提交执行/策略文件。
