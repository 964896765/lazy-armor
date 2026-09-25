# VNext v4.0 第六批：device.consumables 金标准场景（设备耗材管理）

日期：2026-09-25
分支：`fix/rc-full-gate-real-db-concurrency`

## 交付范围

以 `device.consumables@2`（设备耗材提醒）为第二个金标准场景，验证共享 FactDemand / Source Resolver / Strategy / 17 步生命周期 / 消费者结果投影 / Availability-Replan 无需复制即可同时支持「事件驱动」（快递）与「周期驱动」（耗材）两类需求。

- 新增 `Scenario Contract V2` 侧车条目 `device.consumables@2`，引用不可变的 V1 场景定义，不修改 96 场景目录哈希。
- 新增统一 `SourceSelection` 合同（版本 1），互斥区分 `PROVIDER_CONNECTION / TRUSTED_DEVICE / MANUAL_INPUT / INTERNAL_FACT`；旧 `selectedSourceId` 仅作为历史兼容字段。
- 复用 `FactDemandResolver` + Reality Pipeline：`device.consumable.remaining_days` 事实只有取得可验证证据后才 `SATISFIED`；允许手动来源但尚未登记时为 `NEEDS_MANUAL_INPUT`，绝不虚构设备实时读取或推断剩余寿命。
- 复用 `SourceResolver` 与 `DeviceService.resolveInternal`：剩余天数由用户登记的 `lastReplacedAt + replacementIntervalDays` 确定性计算；无数据时不猜。
- 复用 `PREDICTIVE_PREPARE` 策略与 `ActionResolver`：周期提醒、阈值提醒、耗材补充准备（购物清单）与需确认的后续操作。
- 复用消费者结果投影：提醒发送成功 → `SUCCESS`，但不代表耗材已更换；准备购物清单不代表完成购买。

## Scenario Contract V2 关键点

| 维度 | 值 |
|---|---|
| scenario | `device.consumables@2`（不可变 V1 修订） |
| goal.supportedIntents | `NOTIFY_ON_CONSUMABLE_DUE` / `PREPARE_CONSUMABLE_REPLACEMENT` / `DETECT_CONSUMABLE_ANOMALY` |
| goal.requiredSubjectTypes | `device.consumable` |
| factDemand | `device.consumable.remaining_days`（required，`minimumReality: OBSERVED`） |
| acceptedSourceModes | `MANUAL`（用户登记）/ `OFFICIAL_API`（授权设备数据，尚未验证）/ `FILE` / `APP_READ_SESSION` |
| missingPolicy | `ALLOW_MANUAL_ASSISTED`（引导用户登记，而非阻断或猜值） |
| actionDemand | `SEND_NOTIFICATION` |
| governance | `DETERMINISTIC_SANDBOX`，`realSourceVerified: false`，`realActionVerified: false` |

## 真实验收矩阵

| 能力 / 断言 | 确定性 MySQL | Android 真机 | Provider 真实账号 |
|---|---|---|---|
| Scenario Contract V2 校验（`assertScenarioContractV2`） | DETERMINISTIC_VERIFIED | — | — |
| FactDemand 无数据 → `NEEDS_MANUAL_INPUT`（不猜寿命） | DETERMINISTIC_VERIFIED | — | — |
| 手动登记 → Candidate 用户确认 → 类型化 `MANUAL_INPUT` Truth | DETERMINISTIC_VERIFIED | — | — |
| FactDemand 取得证据 → `SATISFIED` + 管理对象/跨用户隔离 | DETERMINISTIC_VERIFIED | — | — |
| Plan Offer v2 保存来源种类、身份、事实版本、证据与新鲜度 | DETERMINISTIC_VERIFIED | — | — |
| Offer → PlanVersion → 策略定时唤醒 → ActionResolver → Execution → Verification | DETERMINISTIC_VERIFIED | — | — |
| 事实过期 / 撤销 → Availability / Replan，不改写旧 PlanVersion | DETERMINISTIC_VERIFIED | — | — |
| 周期提醒 / 阈值提醒 / 购物清单（既有执行生命周期） | DETERMINISTIC_VERIFIED（p1-device / p4-consumer-journeys） | — | — |
| 消费者结果投影（提醒成功 ≠ 已更换） | DETERMINISTIC_VERIFIED | — | — |
| 授权设备实时读取（edge-device `READ_CONSUMABLE`） | DETERMINISTIC_VERIFIED（device-task 通道） | EXTERNAL_ACCEPTANCE_PENDING | EXTERNAL_ACCEPTANCE_PENDING |
| 真实设备 / 真实耗材 Provider | — | EXTERNAL_ACCEPTANCE_PENDING | EXTERNAL_ACCEPTANCE_PENDING |

- `DETERMINISTIC_VERIFIED`：本地 MySQL 8.4 + 确定性测试设备/数据证明，不等同于真实平台或真机。
- `EXTERNAL_ACCEPTANCE_PENDING`：缺少外部环境只阻塞对应真实验收，不阻塞其他安全开发任务。

## 复用性验收结论

- **FactDemand / SourceResolver**：同时支持 `daily_life.delivery`（`TRUSTED_DEVICE`）与 `device.consumables`（`MANUAL_INPUT`），Provider 与内部事实也使用同一类型化合同；复用同一 `FactDemandResolverService` 与 Reality Pipeline，无需复制。
- **Plan Offer 周期 vs 事件**：`PREDICTIVE_PREPARE`（周期/阈值）与 `SILENT_FOLLOW_UP`（事件）共享同一 `StrategyRuntime` 与 `ActionResolver`。
- **消费者结果投影 / 17 步生命周期**：两个场景复用同一 `projectConsumerOutcome` 与生命周期投影，无需复制状态机。
- **诚实边界（本批不宣称）**：未使用真实设备或真实平台账号；用户手动登记不被描述为设备实时读取；`realSourceVerified` / `realActionVerified` 保持 `false`。

## 边界

- 发送提醒成功不等于耗材已更换；更换是用户独立的 `updateReplacement` 动作，会更新 `lastReplacedAt` 并触发事实变化。
- 准备购物清单不等于完成购买；购买需要用户确认，保持既有风险与确认边界。
- 无数据时不推断剩余寿命，返回 `NEEDS_MANUAL_INPUT` 并引导手动登记（`ALLOW_MANUAL_ASSISTED`）。
- `LOCAL_NOTIFICATION_RECORD_PERSISTED` 只验证应用内提醒记录已持久化，不证明用户已经确认，更不证明耗材实际上已经更换。
