# VNext v4.0 Batch 7 C/D — 财务闭环与三金标准回归

日期：2026-09-26。基线：`46e655c`。

## C：finance.accounting

- `finance.accounting@1`（V2-only）经统一 Compiler 生成既有 Plan / PlanVersion / Strategy Binding；不改写 96 个不可变场景或历史 hash。
- 编译结果使用 `finance.transaction` 的内部 Truth 来源，并复用 `classify → summarize → compare → notify → record`、ActionResolver、Execution、Verification 与 Consumer Outcome。
- Risk Engine 改为以统一场景定义解析 V2-only 绑定，同时保留 revision 失败关闭检查。
- 交易事实保留 `accountKey`；报表按币种独立统计，不存在可信汇率事实时不相加。报告证据分别表达归类、周期汇总、核对、差异跟进和报告状态；核对差异不等同于欺诈结论。
- 文件导入继续只产生 Candidate；仅已验证 Truth 可参与账目执行，未开启转账、支付或其他资金操作。

## D：验收边界

确定性 MySQL 集成回归覆盖：快递 `daily_life.delivery`、耗材 `device.consumables`、账目 `finance.accounting` 的共享 FactDemand / Truth / Offer / PlanVersion / Strategy / Action / Execution / Verification 路径。

本地确定性通过不代表：Android 真机通知/设备读取、官方支付/银行 Provider 授权或远端 CI 已验收。当前 `finance.accounting` Contract 仍标记 `DETERMINISTIC_SANDBOX`，生产资金操作保持关闭。

## 已执行门禁

- Plan Schema：135 tests passed。
- API 定向 MySQL 集成：3 files、11 tests passed（账目 Offer 闭环、账目策略、多行交易文件）。
- 后续全量门禁结果以本批提交后的运行日志为准；跳过项不计为通过。
