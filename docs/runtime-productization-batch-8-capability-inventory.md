# VNext v4.0 Batch 8 — 真实信息与低风险执行能力盘点

日期：2026-09-26。此盘点描述当前源码与本地测试能证明的边界；不将模拟、隔离 TCP 或本地 MySQL 结论提升为真机、真实 Provider 或生产能力。

| 能力面 | 当前源码实际支持 | 当前证据 | 所需前提 | 明确缺口 / 下一步 |
|---|---|---|---|---|
| Provider / Connector | Connector catalog、授权连接、健康、能力与风险门禁；GitHub、Gmail、Calendar、Notion、飞书、企业微信、钉钉适配器 | 单元、集成、部分隔离 TCP 适配器测试；完整本地回归当前失败于 GitHub webhook 并发组 | 用户 OAuth/连接、所需 scope、健康 Provider | 无真实银行/支付 Provider 验收；先修复隔离工作区的 webhook 回归，再逐个真实账号验收只读路径 |
| Trusted Device | 可信设备登记、心跳、设备 App 连接与授权范围 | 本地 MySQL 集成与状态门禁 | 用户可信设备、有效证明、在线心跳、App 授权 | 没有本 SHA Android 真机证明 |
| Android Notification / Share | 原生 `NotificationListenerService`、指定包过滤、最小通知快照、主动 Share、App Read session | Kotlin/TS 合同和确定性测试 | 系统通知读取授权、用户选定包、可信设备在线 | 通知只形成 Candidate，不能直认交易；真机读取、上传与断网恢复需单独验证 |
| DeviceTask / Structured Read | 服务端分派、领取、完成/失败证据、移动端 runner 和结构化读取安全边界 | 确定性 client/runner 测试 | 可信在线设备、前台校验、授权 App | fixture 结果不可标为 verified；需真实设备任务回执 |
| MCP / Portable Skill | MCP registry/client/action adapter、Skill descriptor/registry，仍经统一 Execution 与风险门禁 | 合同和集成测试 | 已登记 server、用户授权、可验证 capability | 没有本轮真实外部 MCP 生产验收 |
| Action Adapter | 统一 ActionExecutor / ActionAdapter，低风险 in-app notify、record、classify、summarize、compare；风险动作仍走 Approval | 三金标准本地确定性执行 | 有效 PlanVersion、Availability、Risk/Approval、可用来源 | 禁止自动支付、转账及未批准外部写入 |
| Verification / Reconciliation | Verification contract、证据哈希、OUTCOME_UNKNOWN、Reconciliation case/recheck 和移动端消费者投影 | 单元、MySQL 集成、三金标准定向回归 | 可读取的结果证据或明确未知状态 | 外部副作用结果需要对应渠道的真实 read-back |

## 五条黄金路径与复用方式

| 路径 | 已有可复用链 | 目前可安全做到 | 不得声称 / 后续真实门槛 |
|---|---|---|---|
| 账目整理 | FactDemand → SourceResolver → Reality/Truth → Offer → PlanVersion → PERIODIC_SUMMARY → Verification | 用户确认的文件/手动事实，分类、按币种汇总、核对与报告 | 不能把通知当真实交易；无跨平台显式证据不合并；无真实银行 Provider |
| 快递静默管家 | 同一计划链、事件状态 Truth、notify/record、Availability/Replan | 已验证事件变化后的低风险提醒与记录 | 真实物流平台读数及通知读取仍须独立验收 |
| 设备耗材 | 同一计划链、手动已验证事实、阈值/周期、notify、用户更换确认 | 提醒、确认与实际更换三种结果分开记录 | 真机设备读数和在线 DeviceTask 未验收 |
| 家庭补给 | 复用 FactDemand、SourceResolver、Plan Engine 和低风险 notify/record | 从已验证消费/库存事实生成待确认清单 | 不自动下单或支付；需要合法来源和用户确认 |
| 每日重要事项 | 复用 Truth、现有 Plan/Today 聚合、ActionResolver 和 in-app notification | 聚合已验证计划、异常与提醒并解释优先级 | 不能凭 AI 猜测事实；不能伪装成新的执行引擎 |

## 已发现的可复用运行证据投影

`ReadinessEvidenceService` 已经是五条路径可复用的只读权威投影：它分别计算 capability 的 declared / implemented / authorized / healthy / executable / verifiable 六个维度，并以当前 Truth、AppRead 心跳、可信设备和成功执行记录生成用户级 readiness。`/scenario-coverage-ledger/:key/runtime-evidence` 已有 MySQL 集成覆盖。

下一代码批应当复用该投影，补充“确定性、真机、真实 Provider、同 SHA CI”这四类**发布验收**证据的服务端登记与只读展示；不能以客户端标志或 Contract 中的静态布尔值冒充真实验收。
