# 《懒人装甲：统一运行时产品化总规划 v1.0》

> 阶段名称：**Post-RC Runtime Productization / 统一运行时产品化阶段**  
> 基线：`main@7f0cb36b6359dd6b6823026355aba5cf7e2380e5`  
> RC：`release-candidate-ci #57` 已成功完成  
> 文档日期：2026-09-08  
> 目标：把现有 Plan / Connection / Execution / Risk / Audit 骨架，升级为可长期承载 **19 个领域 + 96 个标准场景 + 8 种策略 + 15 步闭环** 的可信现实世界自动化平台。

> 仓库状态：本文件自 `main@7f0cb36` 起作为统一运行时产品化阶段最高层开发基线。执行进度按 Batch 报告记录；实现若与本文冲突，必须先显式修订本文，禁止暗中偏离。

## 执行进度

2026-09-12 基线收口约束：以 `main@b679250` 冻结 Batch 6～8 完成实现，此后这些 Batch 只允许 bugfix，不再改变核心架构。远端完整门禁与安全修复证据见 [Batch 6～8 远端 CI 收口报告](./runtime-productization-batch-6-8-remote-ci-report.md)；本地通过不等于远端 FULL GREEN。

| Batch | 状态 | 报告 |
| --- | --- | --- |
| Batch 1 — Capability Foundation | 已完成 | [runtime-productization-batch-1-report.md](./runtime-productization-batch-1-report.md) |
| Batch 2 — Scenario Foundation | 已完成 | [runtime-productization-batch-2-report.md](./runtime-productization-batch-2-report.md) |
| Batch 3 — Reality Pipeline | 已完成 | [runtime-productization-batch-3-report.md](./runtime-productization-batch-3-report.md) |
| Batch 4 — Android Foreground Acquisition | 已完成 | [runtime-productization-batch-4-report.md](./runtime-productization-batch-4-report.md) |
| Batch 5 — Strategy Runtime + Dependency Index | 已完成 | [runtime-productization-batch-5-report.md](./runtime-productization-batch-5-report.md) |
| Batch 6 — Capability Resolver | 已完成 | [runtime-productization-batch-6-report.md](./runtime-productization-batch-6-report.md) |
| Batch 7 — Risk / Approval / Execution Integration | 已完成 | [runtime-productization-batch-7-report.md](./runtime-productization-batch-7-report.md) |
| Batch 8 — Verification / Result / Reconciliation | 已完成 | [runtime-productization-batch-8-report.md](./runtime-productization-batch-8-report.md) |
| Batch 9A — Provider Runtime Common Layer | 实现与本地完整门禁完成；本批远端 CI 待验证 | [runtime-productization-batch-9a-report.md](./runtime-productization-batch-9a-report.md) |
| Batch 9B — Gmail Real Integration | 预检后 Hard Stop：缺少真实 Google OAuth Secret；未声明接入完成 | [runtime-productization-batch-9b-preflight-report.md](./runtime-productization-batch-9b-preflight-report.md) |

---

## 0. 结论先行

当前项目不应该再按照“补几个页面、再接几个 App、再为某个领域单独写一个 Service”的方式推进。

后续开发唯一主线冻结为：

```text
Provider / App / Device
        ↓
Provider Capability Manifest
        ↓
Connection + Grant + Health
        ↓
Source Acquisition
        ↓
Source Observation
        ↓
Normalize / Dedupe / Conflict
        ↓
Candidate Fact
        ↓
Truth Record / Resource Fact
        ↓
Scenario Definition
        ↓
Strategy Profile
        ↓
Trigger / Condition
        ↓
Risk / Approval
        ↓
Capability Resolver
        ↓
Existing Execution Engine
        ↓
Verification
        ↓
Result
        ↓
Fallback / Reconciliation
        ↓
Consumer Record + Audit + Provenance
```

所有领域、所有场景、所有 Provider 都必须进入这条链。任何新增功能如果绕开该链，应被视为架构回退。

本阶段最重要的三件事固定为：

1. **Provider Capability Registry**：明确现实世界“能不能拿、能不能做、需要什么权限、现在是否真正可用”。
2. **Generic Observation → Candidate → Truth**：把不同来源变成统一的、可验证、可追溯的事实。
3. **Scenario / Strategy / Capability Resolver Runtime**：让 96 个场景主要通过定义、配置和适配器扩展，而不是 96 套业务引擎。

现有 Execution / Risk / Approval / Outbox / Idempotency / Audit **继续复用，不重写**。

---

# 第一部分：当前基线与架构判断

## 1. 当前项目已经拥有的基础

当前 `AppModule` 已经覆盖统一平台所需的大部分骨架，包括：

- Auth
- Users
- Connectors
- Connections
- Plans
- Templates
- Execution
- Approvals
- Risk
- Audit
- Notifications
- Trusted Devices
- Device Apps
- Truth Store
- Billing
- Logistics
- Household
- Content
- Daily Summary
- Study
- Device
- Profiles
- Operations
- Observability
- Membership / Usage / Cost

Connector SDK 已经具备：

- Connector Metadata
- Capability
- Permission
- R0-R4 Risk
- OAuth2
- Credential Refresh / Revoke
- Connection Health
- Read / Execute / Subscribe
- Idempotency
- Operation Lookup
- Retry Safety
- `OUTCOME_UNKNOWN`

数据库已经具备：

- connectors / connector_capabilities
- connections / credentials
- plans / plan_versions
- executions / steps / events
- approvals
- audit_logs
- truth_records / truth_record_versions
- device app / mobile notification / trusted device 相关结构

因此，本阶段的工作性质不是“重建平台”，而是**把已有骨架补齐成通用运行时**。

## 2. 当前最关键的结构性短板

### 2.1 Truth Store 仍然过度绑定手机账单候选

当前成熟链路主要是：

```text
Android Notification
→ billing_transaction_candidate
→ mobile.billing.transaction
→ 用户确认
→ truth_records
```

当前 Truth 代码还会显式校验：

- `candidateKind = billing_transaction_candidate`
- `candidateResource = mobile.billing.transaction`
- `currency = CNY`
- `parserVersion = generic-notification-v1`

说明 Truth Store 的表结构已经具备通用化基础，但服务层仍需要从“手机账单确认器”升级为“任意 Fact 的事实版本库”。

### 2.2 Device App 当前有发现/通知能力，但还没有正式 AppReadSession Runtime

Android 已经能：

- 发现可启动 App
- 打开 App
- Trusted Device 签名
- 检查通知监听权限
- 按包名启用通知来源
- 收集通知候选
- Drain / Acknowledge 通知事件

下一步不应该直接跳到“万能 Accessibility 自动操作”，而应先建立受控、可审计、可超时、可取消的 **AppReadSession**。

### 2.3 Connector Capability 还没有达到“产品能力合同”的粒度

现有 Capability 已经有：

- key
- name
- riskLevel
- operation
- requiredPermission
- providerAvailability
- sideEffectContract

但还缺：

- 具体可读/可写 Resource
- 字段级数据边界
- OAuth Scope
- Android Permission
- 账号类型要求
- Provider Review 要求
- 实时方式
- 配额/限流
- Reality / Implementation 状态
- Verification Methods
- Explicit Denials
- Official Evidence
- Last Verified At

### 2.4 96 Scenario 当前主要还是产品分类，不是完整运行合同

`product-model.ts` 已经正式定义了：

- 19 Domain
- 96 Scenario
- 8 Strategy
- 15 Lifecycle Step

但 Scenario 目前核心仍是：

```text
key
label
domain
```

下一阶段必须将其升级为声明式 `ScenarioDefinition`。

---

# 第二部分：19 / 96 / 8 / 15 各自扮演什么角色

## 3. 四层模型必须严格分工

### 3.1 Domain：回答“用户在管理什么大类”

Domain 只负责：

- 产品导航
- 信息架构
- 场景分组
- 默认视觉/文案
- 权限和合规分区

**Domain 不拥有独立执行引擎。**

### 3.2 Scenario：回答“用户到底要解决哪类重复问题”

Scenario 是最小“业务运行合同”，负责声明：

- 需要哪些事实
- 哪些事实可选
- 适用哪些 Strategy
- 如何触发
- 允许哪些条件
- 需要哪些读能力
- 需要哪些动作能力
- 风险下限
- 最低 Reality
- 默认 Fallback
- Verification 要求
- 模板/推荐配置

### 3.3 Strategy：回答“系统采用什么管理方式”

8 个 Strategy 不是 8 个 Engine，而是 8 个复用的 **行为 Profile**。

它们规定：

- 默认 Trigger 类型
- Condition 形态
- Attention Policy
- Approval Policy
- Action Mode
- Retry / Verification 偏好
- 消费者通知策略

### 3.4 Lifecycle：回答“任何一次计划执行必须怎样安全走完”

15 步是统一的运行状态骨架。

不同 Strategy 可以让某些步骤 `SKIPPED`，但不能绕开生命周期语义。例如低风险提醒可以：

```text
APPROVAL = SKIPPED(reason=RISK_BELOW_APPROVAL_THRESHOLD)
RECONCILIATION = SKIPPED(reason=OUTCOME_KNOWN)
```

而不是“没有审批步骤”“没有回收步骤”。

这保证每次执行都能解释：

> 数据从哪来、为什么触发、为什么这么做、是否真的成功、失败以后发生了什么。

---

# 第三部分：19 个领域与 96 个场景总目录

## 4. 19 个领域

| Group | Domain Key | 中文 |
|---|---|---|
| money | finance | 财务 |
| life | daily_life | 日常事务 |
| life | family | 家庭 |
| life | health | 健康 |
| life | social | 社交关系 |
| life | pet | 宠物 |
| life | housing | 住房 |
| life | travel | 出行 |
| life | entertainment | 休闲娱乐 |
| work | work | 工作 |
| work | operations | 运营 |
| work | content | 内容创作 |
| work | study | 学习 |
| work | identity_docs | 证件 |
| work | government | 政务 |
| work | legal_contract | 合同与法律事务 |
| things | vehicle | 车辆 |
| things | device | 设备 |
| things | digital_account | 数字账户 |

## 5. 96 个场景的运行化矩阵

> “默认策略”不是唯一策略，而是第一版推荐 Profile；一个 Scenario 可以支持多个 Strategy。  
> Wave 表示 Reality 产品化顺序，不代表 Registry 设计顺序。96 个 Definition 在 Batch 2 一次建完整。

| Domain | Scenario | 中文 | 第一主策略 | 核心 Resource / Fact | Wave |
|---|---|---|---|---|---|
| finance | bill | 账单 | EXPIRY_GUARD | Bill.amount / due_at / status | 1 |
| finance | budget | 预算 | STATE_GUARD | Budget.limit / spend / remaining | 1 |
| finance | balance | 余额 | STATE_GUARD | AccountBalance.amount / observed_at | 1 |
| finance | subscription | 订阅 | EXPIRY_GUARD | Subscription.renewal_at / price / status | 1 |
| finance | refund | 退款 | SILENT_FOLLOW_UP | Refund.status / amount / expected_at | 1 |
| finance | abnormal_transaction | 异常交易 | ANOMALY_DETECTION | Transaction.amount / merchant / category | 1 |
| daily_life | delivery | 快递 | SILENT_FOLLOW_UP | Shipment.status / pickup_deadline / eta | 1 |
| daily_life | payment | 缴费 | EXPIRY_GUARD | Bill.due_at / amount / status | 1 |
| daily_life | subsidy | 补给 | PREDICTIVE_PREPARE | SupplyItem.remaining / consumption_rate | 1 |
| daily_life | appointment | 预约 | EXPIRY_GUARD | Appointment.start_at / status / location | 1 |
| daily_life | errands | 零碎待办 | STATE_GUARD | Task.status / due_at / priority | 1 |
| family | family_supply | 家庭补给 | PREDICTIVE_PREPARE | HouseholdSupply.remaining / usage_rate | 1 |
| family | member_affairs | 成员事项 | EXPIRY_GUARD | HouseholdMemberEvent.due_at / status | 1 |
| family | household_tasks | 家庭分工 | STATE_GUARD | HouseholdTask.owner / status / due_at | 1 |
| family | shared_resources | 共享资源 | STATE_GUARD | SharedResource.state / allocation | 1 |
| family | household_expense | 家庭公共费用 | PERIODIC_SUMMARY | HouseholdExpense.amount / category | 1 |
| health | medication | 用药 | EXPIRY_GUARD | MedicationSchedule.next_at / adherence | 3 |
| health | follow_up | 复诊 | EXPIRY_GUARD | HealthAppointment.next_at / status | 3 |
| health | physical_exam | 体检 | EXPIRY_GUARD | ExamSchedule.due_at / status | 3 |
| health | health_records | 健康资料 | STATE_GUARD | HealthDocument.present / updated_at | 3 |
| health | habit_trends | 习惯与指标趋势 | ANOMALY_DETECTION | WellnessMetric.value / baseline | 3 |
| social | important_contacts | 重要联系人 | PERIODIC_SUMMARY | Contact.last_interaction_at / priority | 2 |
| social | pending_reply | 待回复 | SILENT_FOLLOW_UP | Conversation.awaiting_reply / since | 2 |
| social | anniversary | 纪念日 | EXPIRY_GUARD | Anniversary.date / lead_time | 2 |
| social | gathering_invitation | 聚会邀请 | ASSISTED_ACTION | Invitation.time / RSVP status | 2 |
| pet | vaccination_deworming | 疫苗驱虫 | EXPIRY_GUARD | PetCareSchedule.next_at | 2 |
| pet | feeding_supply | 喂养补给 | PREDICTIVE_PREPARE | PetSupply.remaining / usage_rate | 2 |
| pet | grooming | 洗护 | EXPIRY_GUARD | PetCareSchedule.next_at | 2 |
| pet | health_follow_up | 健康复诊 | EXPIRY_GUARD | PetAppointment.next_at | 2 |
| housing | rent | 房租 | EXPIRY_GUARD | RentPayment.due_at / amount / status | 2 |
| housing | utilities | 物业水电 | EXPIRY_GUARD | UtilityBill.due_at / amount / status | 2 |
| housing | lease | 租约 | EXPIRY_GUARD | Lease.expires_at / notice_at | 2 |
| housing | maintenance | 维修 | SILENT_FOLLOW_UP | MaintenanceCase.status / appointment | 2 |
| housing | home_care | 房屋保养 | PREDICTIVE_PREPARE | HomeCareItem.interval / last_at | 2 |
| travel | itinerary | 行程 | PERIODIC_SUMMARY | TripSegment.time / location / status | 2 |
| travel | tickets | 票务 | EXPIRY_GUARD | Ticket.departure_at / checkin_at | 2 |
| travel | departure_prepare | 出发准备 | PREDICTIVE_PREPARE | Trip.readiness / required_items | 2 |
| travel | accommodation | 住宿 | SILENT_FOLLOW_UP | Booking.status / checkin_at | 2 |
| travel | trip_abnormal | 行程异常 | ANOMALY_DETECTION | TripSegment.status / delay | 2 |
| entertainment | media_games | 影视游戏 | STATE_GUARD | MediaItem.progress / release_at | 3 |
| entertainment | events | 演出活动 | EXPIRY_GUARD | Event.start_at / ticket_status | 3 |
| entertainment | collections | 收藏清单 | STATE_GUARD | CollectionItem.state / priority | 3 |
| entertainment | entertainment_subscription | 娱乐订阅 | EXPIRY_GUARD | Subscription.renewal_at / price | 3 |
| work | tasks | 任务 | STATE_GUARD | Task.status / due_at / priority | 1 |
| work | meetings | 会议 | EXPIRY_GUARD | CalendarEvent.start_at / attendees | 1 |
| work | email | 邮件 | SILENT_FOLLOW_UP | EmailMessage.unread / importance / reply_state | 1 |
| work | files | 文件 | STATE_GUARD | File.state / modified_at / backup_state | 1 |
| work | recurring_work | 周期工作 | PERIODIC_SUMMARY | RecurringTask.next_at / status | 1 |
| work | work_summary | 工作摘要 | PERIODIC_SUMMARY | WorkActivity / Email / Task aggregate | 1 |
| operations | orders | 订单 | SILENT_FOLLOW_UP | Order.status / amount / fulfillment | 2 |
| operations | inventory | 库存 | STATE_GUARD | InventoryItem.quantity / threshold | 2 |
| operations | customers | 客户 | SILENT_FOLLOW_UP | CustomerFollowUp.status / next_at | 2 |
| operations | after_sales | 售后 | SILENT_FOLLOW_UP | AfterSalesCase.status / SLA | 2 |
| operations | campaigns | 活动 | PERIODIC_SUMMARY | Campaign.status / spend / period | 2 |
| operations | business_metrics | 经营数据 | ANOMALY_DETECTION | BusinessMetric.value / baseline | 2 |
| content | topics | 选题 | PREDICTIVE_PREPARE | TopicCandidate.score / trend | 1 |
| content | assets | 素材 | STATE_GUARD | ContentAsset.state / rights / location | 1 |
| content | creation | 创作 | ASSISTED_ACTION | ContentDraft.status / content_hash | 1 |
| content | cross_publish | 一稿多发 | ASSISTED_ACTION | PublicationTarget / publish_state | 1 |
| content | publishing | 发布 | ASSISTED_ACTION | Publication.status / external_id | 1 |
| content | retrospective | 复盘 | PERIODIC_SUMMARY | ContentMetric / Publication aggregate | 1 |
| study | courses | 课程 | STATE_GUARD | Course.progress / next_lesson | 2 |
| study | review | 复习 | EXPIRY_GUARD | ReviewSchedule.next_at / mastery | 2 |
| study | exams | 考试 | EXPIRY_GUARD | Exam.date / readiness | 2 |
| study | materials | 资料 | STATE_GUARD | StudyMaterial.state / topic | 2 |
| study | learning_progress | 学习进度 | PERIODIC_SUMMARY | LearningProgress.value / goal | 2 |
| identity_docs | validity | 有效期 | EXPIRY_GUARD | IdentityDocument.expires_at | 2 |
| identity_docs | renewal | 换证 | ASSISTED_ACTION | RenewalCase.status / appointment | 2 |
| identity_docs | preparation | 材料准备 | PREDICTIVE_PREPARE | DocumentChecklist.completeness | 2 |
| identity_docs | document_records | 证件资料 | STATE_GUARD | IdentityDocument.present / version | 2 |
| government | social_security_fund | 社保公积金 | PERIODIC_SUMMARY | GovernmentAccount.balance / contribution | 3 |
| government | tax | 税务 | EXPIRY_GUARD | TaxObligation.due_at / status | 3 |
| government | government_services | 政务办理 | ASSISTED_ACTION | GovernmentCase.status / requirements | 3 |
| government | government_notices | 政府通知 | SILENT_FOLLOW_UP | GovernmentNotice.type / due_at | 3 |
| legal_contract | renewal | 到期续约 | EXPIRY_GUARD | Contract.expires_at / notice_at | 3 |
| legal_contract | payment_milestone | 付款节点 | EXPIRY_GUARD | ContractMilestone.amount / due_at | 3 |
| legal_contract | performance_milestone | 履约节点 | STATE_GUARD | ContractMilestone.status / due_at | 3 |
| legal_contract | contract_risk | 合同风险 | ANOMALY_DETECTION | ContractClause / change / obligation | 3 |
| vehicle | maintenance | 保养 | PREDICTIVE_PREPARE | Vehicle.odometer / last_service / interval | 1 |
| vehicle | insurance | 保险 | EXPIRY_GUARD | VehicleInsurance.expires_at | 1 |
| vehicle | inspection | 年检 | EXPIRY_GUARD | VehicleInspection.due_at | 1 |
| vehicle | energy | 能源 | STATE_GUARD | Vehicle.fuel_or_battery / range | 1 |
| vehicle | abnormal | 异常 | ANOMALY_DETECTION | VehicleDiagnostic.state / code | 1 |
| vehicle | daily | 车辆日常 | PERIODIC_SUMMARY | Vehicle.odometer / trips / costs | 1 |
| device | warranty | 保修 | EXPIRY_GUARD | Warranty.expires_at | 1 |
| device | consumables | 耗材 | PREDICTIVE_PREPARE | Consumable.remaining / usage_rate | 1 |
| device | maintenance | 维护 | EXPIRY_GUARD | DeviceMaintenance.next_at | 1 |
| device | abnormal | 异常 | ANOMALY_DETECTION | DeviceStatus / health | 1 |
| device | renewal | 续费 | EXPIRY_GUARD | DeviceSubscription.renewal_at | 1 |
| device | status | 设备状态 | STATE_GUARD | Device.online / battery / state | 1 |
| digital_account | login_security | 登录安全 | ANOMALY_DETECTION | LoginEvent.device / location / state | 1 |
| digital_account | oauth | OAuth 授权 | EXPIRY_GUARD | OAuthGrant.expires_at / scopes | 1 |
| digital_account | connection_health | 连接健康 | STATE_GUARD | Connection.health / checked_at | 1 |
| digital_account | memberships | 会员订阅 | EXPIRY_GUARD | Membership.renewal_at / price | 1 |
| digital_account | storage | 容量资源 | STATE_GUARD | StorageQuota.used / limit | 1 |
| digital_account | account_cleanup | 账号清理 | PERIODIC_SUMMARY | DigitalAccount.last_used / risk | 1 |

---

# 第四部分：Scenario Definition——让 96 个场景从“标签”变成“可运行合同”

## 6. 推荐的 ScenarioDefinition

```ts
interface ScenarioDefinition {
  schemaVersion: '1';
  key: string;
  domain: ProductDomainKey;
  label: string;

  primaryResourceTypes: string[];
  requiredFacts: FactRequirement[];
  optionalFacts: FactRequirement[];

  supportedStrategies: PlanStrategyKey[];
  defaultStrategy: PlanStrategyKey;

  sourceRequirements: CapabilityRequirement[];
  actionRequirements: CapabilityRequirement[];

  triggerProfile: TriggerProfile;
  conditionSchema: ConditionSchema;

  defaultRiskFloor: RiskLevel;
  minimumReality: RealityLevel;

  truthPolicy: TruthConsumptionPolicy;
  freshnessPolicy: FreshnessPolicy;
  conflictPolicy: ConflictPolicy;

  verificationRequirements: VerificationRequirement[];
  fallbackPolicy: FallbackPolicy;

  templates: string[];
  availabilityPolicy: ScenarioAvailabilityPolicy;

  revision: number;
  status: 'ACTIVE' | 'BETA' | 'CATALOG_ONLY' | 'DISABLED';
}
```

## 7. 每个 Scenario 必须回答的 12 个问题

每个场景进入 Reality 之前都必须回答：

1. 管理的 Resource 是什么？
2. 最少需要哪些 Fact？
3. Fact 可以来自哪些 Source Mode？
4. 最低可信 Reality 是多少？
5. Fact 多久算过期？
6. 什么事件触发？
7. 条件如何 deterministic 判断？
8. 允许哪些 Strategy？
9. 需要哪些 Capability？
10. 风险最低是多少？
11. 外部动作如何 Verification？
12. 失败、未知、冲突如何 Fallback / Reconcile？

如果其中任意关键问题没有定义，场景只能处于 `CATALOG_ONLY`，不能显示“可自动运行”。

---

# 第五部分：8 种 Strategy 充分发挥的方法

## 8. Strategy 必须是 Profile Registry，不是 8 套 Engine

建议建立：

```ts
interface StrategyProfile {
  key: PlanStrategyKey;
  triggerModes: TriggerMode[];
  conditionPatterns: ConditionPattern[];
  attentionPolicy: AttentionPolicy;
  defaultActionMode: 'OBSERVE' | 'REMIND' | 'PREPARE' | 'EXECUTE';
  approvalPolicy: ApprovalPolicy;
  verificationPolicy: VerificationPolicyRef;
  allowedAutomationCeiling: RiskLevel;
}
```

### 8.1 STATE_GUARD — 状态守护

**目的**：持续监视一个事实状态，只在状态达到阈值或发生变化时行动。

典型：余额过低、库存不足、设备离线、任务未完成。

```text
TruthChanged / ScheduledCheck
→ Compare current state
→ Threshold / state condition
→ Notify / Prepare
```

默认行为：低打扰；相同状态不重复通知；状态恢复可生成恢复记录。

### 8.2 EXPIRY_GUARD — 到期守护

**目的**：管理日期、周期、续费、年检、保修、证件等。

```text
Schedule
→ Read valid_until / due_at
→ remaining_time <= threshold
→ progressive reminder / prepare
```

应内置多级阈值，例如 30 天 / 7 天 / 1 天，但最终由 PlanDefinition 固化。

### 8.3 ANOMALY_DETECTION — 异常发现

**目的**：发现与基线、历史、规则明显不同的变化。

```text
Truth Updated
→ Build deterministic baseline
→ Deviation / rule check
→ Candidate anomaly
→ Notify / Require confirmation
```

AI 可以辅助解释异常，但**不能作为最终数值条件执行器**。

### 8.4 SILENT_FOLLOW_UP — 静默跟进

**目的**：正常状态不打扰，只有终态、异常、超时、关键变化才通知。

典型：退款、快递、售后、订单、待回复。

```text
Status Observation
→ Compare previous Truth
→ No meaningful change = no notification
→ Terminal / abnormal / overdue = notify
```

### 8.5 PERIODIC_SUMMARY — 周期汇总

**目的**：按日/周/月聚合多个 Fact，输出重点，而不是频繁打扰。

```text
Schedule
→ Query Truth Window
→ Aggregate deterministic facts
→ Optional AI summarization
→ Result / Record
```

AI 只能对已确定 Fact 做摘要，不应凭空补事实。

### 8.6 PREDICTIVE_PREPARE — 预测准备

**目的**：根据趋势/使用速度提前预测下一步，并准备动作。

典型：车辆保养、耗材、家庭补给、出发准备。

```text
Truth / Schedule
→ deterministic forecast
→ threshold horizon reached
→ prepare list / appointment / draft
```

第一版预测算法优先简单、可解释，例如线性消耗速度，不追求复杂 ML。

### 8.7 ASSISTED_ACTION — 辅助执行

**目的**：系统准备，人确认后执行。

```text
Prepare ActionIntent
→ Risk
→ Approval Snapshot
→ Capability Resolve
→ Execute
→ Verify
```

适合第一阶段所有存在明显外部副作用的动作。

### 8.8 AUTOMATED_ACTION — 自动执行

**目的**：只在满足明确低风险、确定性、预授权条件时自动完成。

准入条件必须同时满足：

- deterministic condition
- stable Provider capability
- user grant
- healthy connection
- known idempotency/retry semantics
- verification available
- risk <= policy ceiling
- pre-authorization / temporary authorization 合法
- no unresolved conflict

高风险支付、订单、法律、健康关键操作不因“策略=AUTOMATED_ACTION”而降低风险。

## 9. 8 个 Strategy 的 Golden Scenario

| Strategy | Golden Scenario | 验证重点 |
|---|---|---|
| STATE_GUARD | `device.status` 或 `finance.balance` | Truth Change、阈值、去重通知 |
| EXPIRY_GUARD | `vehicle.insurance` | 时间触发、提前量、过期 |
| ANOMALY_DETECTION | `finance.abnormal_transaction` | Baseline、异常判定、解释 |
| SILENT_FOLLOW_UP | `finance.refund` | 状态变化、终态、静默 |
| PERIODIC_SUMMARY | `work.email` / `work.work_summary` | 时间窗聚合、摘要 |
| PREDICTIVE_PREPARE | `vehicle.maintenance` | 里程预测、准备动作 |
| ASSISTED_ACTION | `work.meetings` 创建日程 | Approval Snapshot、写动作、验证 |
| AUTOMATED_ACTION | 低风险内部提醒/标签动作 | 预授权、幂等、自动验证 |

先把这 8 条纵向链全部跑通，实际上就验证了 96 场景的大部分运行拓扑。

---

# 第六部分：15 步 Lifecycle 真正成为 Runtime State

## 10. 生命周期状态枚举

每一步统一使用：

```text
NOT_STARTED
RUNNING
SUCCEEDED
SKIPPED
BLOCKED
FAILED
OUTCOME_UNKNOWN
```

`SKIPPED` 必须有 reason，`BLOCKED` 必须有 recoverability，`FAILED` 必须有 error category。

## 11. 15 步详细运行合同

### Step 1 — CONNECTION_CAPABILITY / 确认连接与能力

**输入**：Scenario/Plan Fact Requirement + Action Requirement  
**检查**：Provider Availability、Implementation Reality、Grant、Health、Device Presence、Policy  
**输出**：Capability Precheck Snapshot  
**失败**：缺连接、授权过期、权限不足 → `BLOCKED`，禁止继续假装读取成功。

### Step 2 — SOURCE_ACQUISITION / 获取现实数据

**实体**：`SourceObservation`  
**输入模式**：Official API / Webhook / OS API / Notification / Share / File / AppRead / Vision / Manual  
**要求**：记录 observedAt、occurredAt、provider、connection、source mode、evidence hash、reality。

### Step 3 — NORMALIZE_DEDUPLICATE / 整理并去重

**实体**：`CanonicalObservation`（可以是持久化表，也可先作为 pipeline entity/event）  
**职责**：schema mapping、unit normalization、time normalization、semantic fingerprint、duplicate window、conflict detection。

### Step 4 — CANDIDATE / 生成候选事实

**实体**：`CandidateFact`  
**职责**：把 Observation 提议为一个 Resource Fact，而不是直接宣布为 Truth。

### Step 5 — TRUTH / 确认为可信事实

**实体**：`TruthRecord + TruthRecordVersion`  
**职责**：Verification、Version、Supersede、Conflict、Expire、Revoke、Freshness、Provenance。

### Step 6 — TRIGGER / 判断是否触发

**实体**：`TriggerDecision`  
**职责**：只判断“是不是到了重新评估这个 Plan 的时机”。  
触发源可为 Schedule、TruthChanged、WebhookEvent、Manual、ConnectionHealthChanged 等。

### Step 7 — CONDITION / 判断条件是否成立

**实体**：`ConditionDecision`  
**要求**：deterministic；记录输入 TruthVersion ID 和计算结果。  
AI 不直接决定最终 true/false。

### Step 8 — RISK / 判断风险

**实体**：`RiskDecision`  
推荐：

```text
effectiveRisk = max(
  capabilityRiskFloor,
  scenarioRiskFloor,
  actionRisk,
  contextElevation
)
```

任何 Plan/AI/模板都不能把 Provider Capability 的风险下限调低。

### Step 9 — APPROVAL / 必要时请用户确认

**实体**：`ApprovalRequest / Grant`  
确认必须绑定不可变快照：

- PlanVersion
- Capability
- Provider/Target
- Amount
- Content hash
- Resource ID
- SideEffectKey
- Scope
- ExpiresAt

任何实质内容变化都必须让旧 Approval 失效。

### Step 10 — CAPABILITY_RESOLUTION / 选择执行方式

**实体**：`CapabilityResolutionDecision`  
先做硬过滤，再做排序。

硬过滤：官方能力、实现状态、授权、健康、Reality、设备在线、风险、用户政策。  
排序：可靠性、Freshness、Latency、Cost、用户偏好、验证能力。

输出：Selected Provider / Connection / Capability / Device + Fallback Candidates + Decision Reasons。

### Step 11 — EXECUTION / 执行动作

**实体**：沿用现有 Execution / Attempt / Step / Outbox。  
入口统一为：

```text
ActionIntent
→ CapabilityResolver
→ ActionAdapter
→ Existing Execution Runner
```

不重写 Lease / Claim / Worker / Outbox / Idempotency / Retry。

### Step 12 — VERIFICATION / 验证真实结果

**实体**：`VerificationEvidence`  
原则：请求发送成功、按钮点击成功、Intent 发出成功，都不等于业务成功。

验证可使用：

- provider returned object ID
- GET/read-back
- webhook confirmation
- operation lookup
- device foreground/state confirmation
- signed device event
- user confirmation（最后手段）

### Step 13 — RESULT / 形成结果

业务结果固定包含：

```text
SUCCEEDED
PARTIALLY_SUCCEEDED
FAILED
OUTCOME_UNKNOWN
```

`OUTCOME_UNKNOWN` 必须是一等结果，不能被包装成普通失败后自动重试。

### Step 14 — FALLBACK_RECONCILIATION / 处理失败或未知

**实体**：`ReconciliationCase`  
处理顺序：

```text
operation lookup
→ webhook wait
→ re-read provider state
→ alternate evidence
→ device confirmation
→ user confirmation
```

如果仍未知，保持 Unknown 并明确交给用户，而不是重复产生潜在副作用。

### Step 15 — RECORD_AUDIT / 记录与安全审计

分为两套视图：

**Consumer Record**：用户看得懂。  
例如：“15:09 检测到余额低于 20 元，已提醒充值。”

**Audit**：系统追责。  
至少关联：Connection、Observation、Candidate、TruthVersion、PlanVersion、TriggerDecision、ConditionDecision、RiskDecision、Approval、Resolution、Execution、Verification、Result、Reconciliation。

---

# 第七部分：Resource / Fact Model——让 Plan 与 Provider 解耦

## 12. Resource Catalog 第一版

### Communication / Work

- EmailMessage
- CalendarEvent
- Task
- File
- Contact
- Conversation

### Finance

- Transaction
- AccountBalance
- Bill
- Budget
- Subscription
- Refund
- Invoice

### Commerce / Logistics

- Order
- Shipment
- Product
- InventoryItem
- AfterSalesCase

### Household

- Household
- HouseholdMember
- HouseholdTask
- SupplyItem
- UtilityAccount

### Vehicle

- Vehicle
- VehicleServiceRecord
- VehicleInsurance
- VehicleInspection
- VehicleDiagnostic

### Device

- Device
- DeviceStatus
- Consumable
- Warranty
- DeviceSubscription

### Identity / Account

- IdentityDocument
- DigitalAccount
- OAuthGrant
- Membership
- StorageQuota

### Content / Social

- ContentItem
- ContentAsset
- ContentDraft
- Publication
- PublicationTarget
- ContentMetric

### Travel / Place

- Trip
- TripSegment
- Ticket
- Booking
- Place

后续按 Scenario Requirements 增量补 Resource，但必须经过 Catalog Review，禁止业务代码自行发明同义模型。

## 13. Fact 命名和类型规则

推荐 Canonical Fact Key：

```text
email.message.unread
email.message.sender
calendar.event.start_at
finance.transaction.amount
finance.balance.amount
shipment.status
shipment.pickup_deadline
vehicle.odometer
vehicle.insurance.expires_at
device.consumable.remaining_days
digital_account.connection.health
```

Fact Schema 必须声明：

- type：string / number / boolean / datetime / enum / money / quantity / object ref
- unit
- nullable
- enum values
- freshness TTL
- semantic identity
- sensitivity
- minimum reality
- accepted verification methods

## 14. Truth 不是“一个 JSON”，而是带时效和来源的版本事实

每个 Truth Version 至少要能回答：

```text
resourceType
resourceKey
subjectKey
field
value
valueType
unit
observedAt
occurredAt
verifiedAt
validUntil
confidence
realityLevel
verificationMethod
provenance[]
evidenceHash
supersedesVersionId
```

---

# 第八部分：Provider Capability Manifest

## 15. Capability Manifest 是 Provider 与平台之间的“法律合同 + 技术合同”

```ts
interface ProviderCapabilityManifest {
  schemaVersion: '1';
  providerKey: string;
  capabilityKey: string;
  revision: number;

  operation: 'READ' | 'EXECUTE' | 'SUBSCRIBE';

  dataResources: string[];
  writableResources: string[];
  fieldBoundaries: string[];

  requiredScopes: string[];
  androidPermissions: string[];
  accountRequirements: string[];

  providerReview: {
    required: boolean;
    status: 'NOT_REQUIRED' | 'TO_VERIFY_OFFICIAL' | 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  };

  sourceModes: SourceMode[];
  realtime: RealtimeCapability;
  quota: QuotaPolicy;
  dataBoundary: DataBoundary;

  riskFloor: RiskLevel;
  verificationMethods: string[];

  providerAvailability: 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE' | 'TO_VERIFY_OFFICIAL';
  implementationStatus: 'NOT_IMPLEMENTED' | 'STUB' | 'BETA' | 'PRODUCTION_READY' | 'DISABLED';

  explicitDenials: string[];
  evidence: EvidenceRef[];
  lastVerifiedAt: string | null;
  deprecatedAt?: string | null;
}
```

## 16. “可用”必须由四个维度共同决定

不要再用一个 `connected=true` 表示一切。

### ① Provider Availability

官方到底有没有开放该能力。

### ② Implementation Reality

懒人装甲是否真正完成了生产实现，而不是 Demo/Mock。

### ③ Connection Grant

当前用户有没有授予所需 Scope / Permission。

### ④ Runtime Health

这一刻 Token、Provider、设备、网络、权限是否健康。

最终：

```text
RuntimeUsable =
  ProviderAvailable
  AND ImplementationReady
  AND GrantSatisfied
  AND HealthUsable
```

UI “当前可用”只能由该计算结果产生。

## 17. Provider Evidence 规则

任何能力如果没有官方依据：

```text
providerAvailability = TO_VERIFY_OFFICIAL
```

禁止根据 App UI、第三方博客、逆向结果猜测“官方支持”。

Evidence 建议记录：

- officialUrl
- documentTitle
- scope / endpoint
- checkedAt
- documentVersion / etag（可得时）
- evidenceHash
- note

---

# 第九部分：首批 Provider Registry

## 18. 首批 18 个 Provider

原规划文字写“18 个”，实际列出的名称是 17 个。为使 Registry 数量一致，建议将 **Google Contacts** 补为第 18 个；它也非常适合与 Gmail / Google Calendar 一起验证 Google OAuth、Scope 和连接健康。

1. WeChat / 微信
2. Alipay / 支付宝
3. Taobao / 淘宝
4. JD / 京东
5. Gmail
6. Google Calendar
7. **Google Contacts**
8. Douyin / 抖音
9. Kuaishou / 快手
10. Bilibili / B站
11. Xiaohongshu / 小红书
12. YouTube
13. Instagram
14. X
15. Telegram
16. Discord
17. Notion
18. GitHub

Batch 1 只要求把 Registry / Manifest / Evidence / Reality 架构建完整；**不要求 18 个同时真接 API**。

每个 Provider 初次进入 Registry 必须至少有：

```text
Provider Metadata
Account Types
Capability Skeletons
Scope Skeletons
Source Modes
Action Modes
Provider Review
Rate Limit / Quota
Data Boundary
Risk Floor
Verification Method
Explicit Denials
Implementation Reality
Official Evidence Status
```

未知项统一 `TO_VERIFY_OFFICIAL`。

---

# 第十部分：Connection / Grant / Health

## 19. Connection 以后不再等于 Capability

一个 Gmail Connection 可以存在，但 `SEND_EMAIL` 未授权；也可以授权过但 Token 已过期。

因此正式拆分：

```text
Connection
  ├─ identity/account
  ├─ credential reference
  ├─ user/device binding
  └─ provider

ConnectionCapabilityGrant
  ├─ capabilityKey
  ├─ granted scopes
  ├─ grantedAt
  ├─ expiresAt
  └─ revokedAt

ProviderCapabilityHealth
  ├─ capabilityKey
  ├─ connectionId
  ├─ status
  ├─ checkedAt
  └─ reason
```

Health 建议至少：

```text
HEALTHY
DEGRADED
REAUTHORIZATION_REQUIRED
PERMISSION_REVOKED
RATE_LIMITED
PROVIDER_UNAVAILABLE
DEVICE_OFFLINE
UNHEALTHY
```

---

# 第十一部分：Generic Source Observation Pipeline

## 20. 所有现实来源统一进入 Observation

Source Mode 固定枚举：

```text
OFFICIAL_API
WEBHOOK
OS_API
NOTIFICATION
SHARE
FILE
APP_READ
VISION
MANUAL
```

推荐优先级：

```text
S1 Official API / Webhook
S2 OS / Device API
S3 Notification / Share / File
S4 Accessibility Structured Read
S5 MediaProjection / Vision
S6 Manual
```

这不是简单的“质量排序”；还要综合字段覆盖、Freshness、可验证性和用户授权。

## 21. SourceObservation

```ts
interface SourceObservation {
  id: string;
  userId: string;
  connectionId?: string;
  providerKey: string;
  sourceMode: SourceMode;

  resourceType?: string;
  resourceHint?: string;

  occurredAt?: Date;
  observedAt: Date;

  rawPayloadRef?: string;
  payloadSchema: string;
  evidenceHash: string;

  realityLevel: RealityLevel;
  parserVersion?: string;

  correlationId: string;
}
```

原则：Observation 只是“观察到了什么”，不是“事实一定是真的”。

## 22. 原始数据处理原则

- 数据最小化
- 默认不长期存储完整原始正文
- 必要原始 payload 使用加密 Blob / secure reference
- 敏感字段单独 retention
- EvidenceHash 与结构化摘要长期可追溯
- Connector 的 DataBoundary 控制可入库字段
- 用户撤销连接后按照 retention policy 清理可删除原始数据，但 Audit/不可变事实链按政策保留必要哈希和元信息

---

# 第十二部分：Normalize / Dedupe / Conflict

## 23. 建立三个 Registry

### NormalizerRegistry

负责 Provider schema → Canonical Resource schema。

### ParserRegistry

负责非结构化/半结构化来源，例如 Notification / Share / File。

### DedupePolicyRegistry

负责同一现实事件在多个渠道重复出现时的合并。

## 24. Semantic Fingerprint

例如同一笔 399 元消费可能来自：

- 支付宝通知
- 银行短信/通知
- Gmail 收据

不能生成 3 笔消费。

Fingerprint 可综合：

```text
resourceType
subject/account
amount
currency
merchant_normalized
timestamp_bucket
external_id
provider event id
order id
```

必须区分：

- exact duplicate
- likely duplicate
- conflicting observation
- independent event

## 25. Freshness 与 Conflict

每种 Fact 定义 TTL，例如：

- connection.health：分钟级
- shipment.status：小时级
- vehicle.odometer：天级或最新读数
- insurance.expires_at：长期稳定

ConflictPolicy 示例：

```text
OFFICIAL_API 最新确认值 > 通知候选
同 Reality 时，较新 verifiedAt 优先
关键冲突不能自动覆盖 → WAITING_USER / multi-source verification
```

---

# 第十三部分：Generic Candidate

## 26. CandidateFact

```ts
interface CandidateFact {
  id: string;
  userId: string;

  resourceType: string;
  resourceKey: string;
  subjectKey: string;
  field: string;

  proposedValue: unknown;
  valueType: string;
  unit?: string;

  confidence: number;
  realityLevel: RealityLevel;
  sourceObservationIds: string[];

  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'SUPERSEDED' | 'EXPIRED';

  createdAt: Date;
  expiresAt?: Date;
  decidedAt?: Date;
}
```

继续保留当前已经验证过的能力：

- DB unique constraint
- 原子决定
- 并发 exactly-once decision
- 重复确认读回已完成结果

但把它从 `mobile.billing.transaction` 泛化为任意 Resource Fact。

---

# 第十四部分：Generic Truth Store

## 27. 保留现有 truth_records / truth_record_versions，不推倒

建议扩展而不是重建。

Truth Record 负责“身份和当前版本”，Truth Version 负责“不可变值和证据”。

至少支持：

- Version
- Supersede
- Conflict
- Revoke
- Expire
- Freshness
- Multiple Sources
- Verification Method
- Reality Level
- Provenance

## 28. Truth 写入状态机

```text
Candidate
→ verification policy
→ VERIFIED
→ new observation
→ SAME / SUPERSEDE / CONFLICT
→ revoked/expired if necessary
```

任何 Plan 读取 Truth 时必须声明：

```text
minimumReality
maxAge
allowConflicted=false
allowUnverified=false
```

---

# 第十五部分：Scenario Compiler / Plan Compiler

## 29. 这是“96 个场景能批量落地”的关键组件

不要手写 96 套 Plan Engine 流程。

建立：

```text
ScenarioDefinition
+ StrategyProfile
+ User Configuration
+ Available Capabilities
        ↓
ScenarioPlanCompiler
        ↓
Immutable PlanDefinition / PlanVersion
```

Compiler 输出：

- Fact Dependencies
- Source Capability Requirements
- Trigger Definition
- Condition AST
- ActionIntent Templates
- Risk Floor
- Approval Policy
- Verification Policy
- Fallback Policy
- Consumer Explanation

这样一个新 Scenario 主要是“定义 + Resource + Adapter”，而不是“新 Engine”。

---

# 第十六部分：Trigger / Condition Runtime

## 30. AI 的边界

AI 可以：

- 理解自然语言
- 建议 Scenario
- 建议 Strategy
- 把自然语言编译成 Condition AST
- 对 Truth 做摘要/解释

AI 不可以：

- 在运行时凭自由文本决定是否触发高风险动作
- 绕过 Capability/Risk/Approval
- 虚构不存在的 Provider 能力
- 把不确定 Observation 当作已验证 Truth

## 31. Condition Operator 固定集合

```text
EQ
NE
GT
GTE
LT
LTE
IN
NOT_IN
CONTAINS
EXISTS
CHANGED
CHANGED_BY
COUNT
WITHIN_WINDOW
ALL
ANY
NOT
```

后续加 Operator 必须版本化。

ConditionDecision 必须记录：

- condition schema version
- TruthVersion IDs
- evaluated input values
- operator
- result
- evaluatedAt

## 32. Truth Dependency Index

不要在每个 Truth 变化时扫描所有 Plan。

建立：

```text
FactDependency
factKey / resourceType / field
→ active PlanVersion IDs
```

流程：

```text
Truth changed
→ dependency index lookup
→ enqueue only dependent plans
```

还要支持：

- exact subject dependency
- resource-wide dependency
- user-wide aggregate dependency
- scheduled plans

---

# 第十七部分：Capability Resolver——Plan 与 Provider 的隔离层

## 33. Plan 只声明“需要什么能力”，不声明“必须哪个 App”

例如：

```text
READ_EMAIL_BODY
READ_SHIPMENT_STATUS
GET_VEHICLE_ODOMETER
CREATE_CALENDAR_EVENT
OPEN_APP
SEND_MESSAGE
```

Provider 只是实现候选。

## 34. Resolver 输入

```text
Capability Requirement
Resource / Subject
User
PlanVersion
Risk Context
Freshness Requirement
Reality Requirement
User Preferences
Device Context
Cost Policy
```

## 35. Resolver 两阶段决策

### 阶段 1：Hard Filter

必须全部满足：

- Provider capability AVAILABLE
- Implementation Ready
- Grant Satisfied
- Runtime Health Usable
- Account Requirement Satisfied
- Device Requirement Satisfied
- Reality >= minimum
- Freshness satisfiable
- Risk allowed
- Data Boundary allowed
- Provider not explicitly denied

### 阶段 2：Rank

候选按：

- reliability
- verification strength
- freshness
- latency
- cost
- provider preference
- source mode preference

输出持久化 `CapabilityResolutionDecision`。

## 36. Fallback 不等于“自动换 Provider 一定执行”

读能力可以安全 fallback 的场景较多；写能力必须结合 SideEffectContract。

例如：

- Gmail READ timeout → 可以换另一个 read source（若语义相同）
- 创建订单 timeout → 不能简单换 Provider 再创建

---

# 第十八部分：Risk / Approval 集成

## 37. Risk Floor 永远不可降级

推荐风险合成：

```text
R_effective = MAX(
  ProviderCapability.riskFloor,
  Scenario.defaultRiskFloor,
  ActionIntent.risk,
  ContextRiskElevation
)
```

例如：

- READ_EMAIL_BODY：可能 R1
- CREATE_DRAFT：R2
- SEND_EMAIL：R3
- CREATE_ORDER：R3
- PAYMENT：R4

具体等级最终由安全政策冻结；上面只是结构例子。

## 38. Approval Snapshot 必须不可变

Approval 同意的是一个具体动作，而不是一句“以后都同意”。

任何以下变化应使旧 Approval 失效：

- target 变化
- amount 变化
- content hash 变化
- capability 变化
- provider/connection 变化（当语义/风险受影响）
- PlanVersion 变化
- sideEffectKey 变化
- 超过 expiresAt

---

# 第十九部分：Execution Engine 保持稳定，只做适配

## 39. 禁止重写现有 Execution Engine

新架构接入方式固定：

```text
Scenario / Condition
→ ActionIntent
→ Risk / Approval
→ Capability Resolver
→ ActionAdapter
→ Existing Execution Runner
```

继续复用：

- execution claim / lease
- worker separation
- outbox
- idempotency
- provider idempotency key
- side effect contract
- retry safety
- operation lookup
- audit

## 40. ActionIntent

```ts
interface ActionIntent {
  intentId: string;
  planVersionId: string;
  capabilityKey: string;
  resourceType: string;
  target: unknown;
  payload: unknown;
  payloadHash: string;
  desiredOutcome: string;
  sideEffectKey?: string;
}
```

Execution 不直接理解“车辆保养”“快递”“财务”；它只执行经过 Resolver 的 Capability。

---

# 第二十部分：Verification Registry

## 41. 每一个 Execute Capability 必须声明如何证明成功

```ts
interface VerificationPolicy {
  capabilityKey: string;
  methods: VerificationMethod[];
  timeoutMs: number;
  successPredicate: Predicate;
  partialPredicate?: Predicate;
  fallback: VerificationFallback;
}
```

例：

### Open App

```text
Intent dispatched
→ foreground package == target
→ verified
```

### GitHub Create Issue

```text
POST
→ issueId
→ GET issueId
→ title/body hash matches
→ verified
```

### Calendar Create Event

```text
Create
→ eventId
→ GET event
→ time/title/attendees match
→ verified
```

### 支付/订单类

绝对不能：

```text
点击按钮成功 = 业务成功
```

必须依赖 Provider final state / operation lookup / webhook / transaction record。

---

# 第二十一部分：Result 与 OUTCOME_UNKNOWN

## 42. Result Model

```text
SUCCEEDED
PARTIALLY_SUCCEEDED
FAILED
OUTCOME_UNKNOWN
```

另外 Lifecycle 可以有 CANCELLED/BLOCKED/TIMEOUT，但最终外部动作结果必须落到可解释状态。

## 43. OUTCOME_UNKNOWN 触发条件

典型：

```text
Provider 接收请求
→ 网络断开
→ 本地不知道 Provider 是否已产生副作用
```

这时：

- 禁止盲目重试 unsafe action
- 进入 reconciliation
- 保留 operation/idempotency/provenance
- Consumer UI 显示“结果正在确认”，而不是“失败”

---

# 第二十二部分：Reconciliation Worker

## 44. Reconciliation 独立成 Worker

状态建议：

```text
OPEN
WAITING_PROVIDER
WAITING_WEBHOOK
RECHECKING
WAITING_DEVICE
WAITING_USER
RESOLVED_SUCCEEDED
RESOLVED_FAILED
UNRESOLVED
EXPIRED
```

策略顺序：

1. operation lookup
2. provider read-back
3. webhook/event wait
4. idempotency lookup
5. device confirmation
6. user confirmation
7. unresolved escalation

Worker 必须保证同一 Case 幂等处理。

---

# 第二十三部分：Record / Audit / Provenance

## 45. Consumer Record 和 Audit 分离

### Consumer Record

面向用户：

- 发生了什么
- 为什么提醒/执行
- 结果是什么
- 需要用户做什么

### Audit

面向系统/安全：

- actor
- PlanVersion
- capability
- connection
- observation IDs
- candidate IDs
- truth versions
- trigger / condition inputs
- risk snapshot
- approval snapshot
- resolution decision
- execution attempt
- verification evidence
- result
- reconciliation

## 46. Correlation ID 全链贯穿

一个 Journey 从 Observation 到 Record 必须可以通过一个顶层 correlationId / executionId 串起来。

---

# 第二十四部分：AppReadSession

## 47. 第一阶段目标不是自动操作，而是“受控读取会话”

流程：

```text
Create Session
→ Validate Trusted Device
→ Launch App
→ Wait Foreground
→ Heartbeat
→ Read permitted events
→ Parse
→ Validate
→ Candidate / Observation
→ Complete / Partial / Timeout
```

## 48. 状态机

```text
CREATED
LAUNCHING
WAITING_FOREGROUND
READING
PARSING
VALIDATING
WAITING_USER
PARTIAL
COMPLETED
FAILED
CANCELLED
TIMEOUT
APP_LEFT_FOREGROUND
```

## 49. 第一批 Android 能力

必须先做：

- Foreground Package Guard
- Foreground Service
- Session Heartbeat
- Session Event
- Notification Reader 接入 Observation
- Share Receiver
- Device trust / signature 复用
- Session timeout / cancel

第二批再做：

- Accessibility Semantic Snapshot（只读结构化节点）

第三批：

- MediaProjection / Vision

万能自动点击、后台偷读、全设备 agent 暂不做。

## 50. 悬浮球定位

悬浮球只是 Session Controller：

```text
正在读取
需要你操作
读取完成
读取失败
停止
返回懒人装甲
```

不是数据引擎本身。

---

# 第二十五部分：Mobile 从静态 UI 变为 Registry 驱动

## 51. 前端原则

暂时停止继续大规模增加页面。

现有页面开始消费真实 Registry/Runtime 状态。

## 52. Connection Center

每个 Provider 显示四层状态：

```text
官方支持：是 / 有限 / 待核验 / 否
懒人装甲实现：Ready / Beta / Stub / No
用户授权：Granted / Partial / Missing / Revoked
当前健康：Healthy / Degraded / Reauth / Offline
```

同时展示：

- 可读取什么
- 可执行什么
- 未授权能力
- 明确不支持
- Provider Review
- Reality
- 使用该连接的 Plan
- 最近 Observation
- 最近错误

## 53. Domain Workspace

数据全部来自 `ScenarioRegistry`：

- 可运行场景
- Catalog Only 场景
- 已安装 Plan
- Source 缺口
- Capability 缺口
- Reality 缺口

前端不再硬编码 96 张卡。

## 54. Scenario Workspace

显示：

- 场景说明
- 推荐 Strategy
- 所需 Facts
- 当前已有 Sources
- 缺失 Sources
- 可创建模板
- Automation Ceiling
- 当前 Reality

## 55. Plan Detail 的消费者版 15 步

不必显示技术名，但要能解释：

```text
数据从哪里来
当前事实是什么
什么时候检查
满足什么条件
会做什么
什么时候需要你确认
用哪个服务执行
怎么确认成功
最近结果
失败怎么办
```

## 56. 路由冻结

```text
Rail
├─ Messages
├─ Lazy Armor
├─ Lazy Mall
├─ Pinned Connections
├─ Connection Center
└─ Me
```

连接：

```text
/connections
/connections/add
/connections/:id
/connections/apps
```

领域：

```text
/domains
/domains/:domain
/domains/:domain/:scenario
```

Plan：

```text
/plans
/plans/new
/plans/:id
/plans/:id/executions
```

安全：

```text
/me
/me/devices
/me/permissions
/me/privacy
/me/audit
```

---

# 第二十六部分：数据库迁移规划

## 57. Migration Set 1 — Capability Foundation

### provider_capability_manifests

核心列：

- id
- provider_key
- capability_key
- revision
- operation
- manifest_json
- provider_availability
- implementation_status
- risk_floor
- last_verified_at
- created_at
- superseded_at

唯一约束：

```text
(provider_key, capability_key, revision)
```

### provider_capability_evidence

- manifest_id
- evidence_type
- official_url
- document_title
- evidence_hash
- checked_at
- status

### connection_capability_grants

- connection_id
- capability_key
- granted_scopes_json
- granted_at
- expires_at
- revoked_at
- grant_fingerprint

### provider_capability_health

- connection_id
- capability_key
- health_status
- checked_at
- reason_code
- detail_json

## 58. Migration Set 2 — Reality Pipeline

### source_observations

重点索引：

```text
(user_id, observed_at)
(connection_id, observed_at)
(provider_key, observed_at)
(resource_type, observed_at)
(evidence_hash)
```

### candidate_facts

重点约束/索引：

```text
(user_id, semantic_fingerprint)
(status, expires_at)
(resource_type, subject_key, field)
```

## 59. Migration Set 3 — App Read

### app_read_sessions

- user/device/connection/package
- state
- started_at
- heartbeat_at
- ended_at
- timeout_at
- failure_reason

### app_read_session_events

- session_id
- seq
- event_type
- payload_json
- occurred_at

唯一：`(session_id, seq)`。

## 60. Migration Set 4 — Runtime Decisions

### capability_resolution_decisions

保存输入要求、候选、选中项和 reason。

### verification_evidence

保存 method / source / payload hash / verifiedAt / result。

### reconciliation_cases

保存 unknown operation 的生命周期。

## 61. 已有表优先扩展

不要重复造：

- execution step
- audit
- approval
- truth version
- connection
- credential

Migration 必须继续遵守：

- no DROP/TRUNCATE
- forward-only
- idempotent where applicable
- MySQL 8.4 verified
- backup/restore gate
- migration rollback strategy 通过补偿 migration，而非破坏历史数据

---

# 第二十七部分：建议的 API Surface

## 62. Provider / Capability

```text
GET  /providers
GET  /providers/:providerKey
GET  /providers/:providerKey/capabilities
GET  /providers/:providerKey/capabilities/:capabilityKey
GET  /providers/:providerKey/evidence
```

管理/内部 Registry 写入尽量走代码 migration/seed + Admin，不开放消费者自由修改。

## 63. Connection Capability

```text
GET  /connections/:id/capabilities
GET  /connections/:id/capabilities/health
POST /connections/:id/capabilities/:key/validate
```

OAuth start/callback/permission API 继续复用现有 Connections API。

## 64. Scenario / Resource Catalog

```text
GET /domains
GET /domains/:domain/scenarios
GET /scenarios/:key
GET /scenarios/:key/readiness
GET /resources
GET /resources/:type/facts
```

## 65. Observation / Candidate / Truth

消费者 API 要克制：

```text
GET  /truth
GET  /truth/:id
GET  /candidates/pending
POST /candidates/:id/confirm
POST /candidates/:id/reject
```

Observation 原始流主要内部使用，必要的用户调试视图必须做字段脱敏。

## 66. App Read

```text
POST /app-read-sessions
GET  /app-read-sessions/:id
POST /app-read-sessions/:id/cancel
POST /app-read-sessions/:id/events   // signed trusted device
POST /app-read-sessions/:id/heartbeat // signed trusted device
```

## 67. Runtime Explainability

建议新增消费者解释 API：

```text
GET /plans/:id/runtime-status
GET /executions/:id/explanation
GET /executions/:id/provenance
```

---

# 第二十八部分：96 场景如何按部就班做完

## 68. 不按“领域一个一个写”，而按“共性能力切片”推进

错误方式：

```text
先完整 Finance Engine
→ 再完整 Vehicle Engine
→ 再完整 Health Engine
```

正确方式：

```text
统一 Fact / Strategy / Capability 能力
→ 一次解锁多个领域的多个 Scenario
```

例如实现：

```text
expires_at Fact
+ Schedule Trigger
+ EXPIRY_GUARD
+ Reminder Action
```

一次可以解锁：

- 订阅续费
- 保险到期
- 年检
- 保修
- 证件有效期
- 房租/租约
- 考试
- 纪念日
- 宠物疫苗
- 合同续约

这就是“充分利用 8 Strategy”的核心价值。

## 69. 每个 Scenario 的 Definition of Done

一个 Scenario 从 Catalog 进入正式可运行，必须完成：

1. ScenarioDefinition 已冻结并版本化
2. Primary Resource 已存在
3. Required Facts 有 schema
4. 至少一个合法 Source Mode
5. Source Adapter / Normalizer 可产生 Observation
6. Dedupe Policy 有定义
7. Candidate → Truth policy 可运行
8. Freshness/Conflict policy 有定义
9. Trigger deterministic
10. Condition AST deterministic
11. StrategyProfile 已绑定
12. Action Capability 已声明
13. Capability Resolver 可得到可用候选
14. Risk Floor 已定义
15. Approval Policy 已定义
16. Verification Policy 已定义
17. Fallback/Reconciliation 已定义
18. Consumer Record 文案已定义
19. Provenance 可追踪
20. 单元/集成/并发/Journey Test 通过

缺任何关键项，就不能标 `AUTOMATED_READY`。

## 70. Scenario Readiness 状态

```text
CATALOG_ONLY
MANUAL_READY
OBSERVE_READY
ASSISTED_READY
AUTOMATED_READY
BLOCKED_PROVIDER
BLOCKED_IMPLEMENTATION
DISABLED
```

配合一个 Readiness Score，但 UI 以明确状态为准，不靠模糊百分比。

## 71. Reality 升级路径

一个场景可以这样成长：

```text
CATALOG_ONLY
→ MANUAL_READY
→ NOTIFICATION/FILE OBSERVE_READY
→ OFFICIAL_API OBSERVE_READY
→ ASSISTED_READY
→ AUTOMATED_READY（仅安全场景）
```

这样 96 个场景可以一次全部进入产品目录，但不会假装全部已经自动化。

---

# 第二十九部分：Scenario Reality 三波升级

## 72. Wave 1 — 约 35～40 个最值得做真的场景

重点领域：

- finance
- daily_life
- family
- work
- content
- vehicle
- device
- digital_account

优先：

- 账单 / 余额 / 订阅 / 退款 / 异常交易
- 快递 / 缴费 / 补给
- 家庭补给 / 家庭费用
- 邮件 / 会议 / 工作摘要
- 一稿多发 / 发布 / 复盘
- 车辆保养 / 保险 / 年检
- 设备耗材 / 保修 / 状态
- OAuth / 连接健康 / 登录安全 / 会员订阅

## 73. Wave 2

- operations
- housing
- travel
- study
- pet
- social
- identity_docs

## 74. Wave 3

- health
- government
- legal_contract
- entertainment
- 高风险 Action

Health / Legal 等第一版重点做行政提醒、资料管理、时间节点和用户确认，不让自动化系统越过专业决策边界。

---

# 第三十部分：Provider 真接入顺序

## 75. 第一组：验证统一架构

1. Gmail
2. Google Calendar
3. GitHub
4. Notion

验证：

- OAuth
- Scope
- Read
- Write
- Connection Health
- Reauthorization
- Webhook/Push（平台支持时）
- Verification
- Idempotency / retry semantics

Google Contacts 可作为同组扩展，用于 Contact Resource。

## 76. 第二组：内容/社交/实时事件

- YouTube
- X
- Discord
- Telegram Bot

验证：

- 内容资源
- 消息/事件
- 发布
- rate limit
- provider review
- webhook/subscription

## 77. 第三组

- Douyin
- Kuaishou

## 78. 第四组

- WeChat
- Alipay
- Taobao
- JD
- Bilibili
- Xiaohongshu
- Instagram

这一组更依赖：

- Provider qualification
- 特定账号类型
- Notification / Share / Device fallback
- 审核
- 明确的数据边界

绝不能假设普通消费者账号拥有完整 API。

---

# 第三十一部分：6 条跨系统真实闭环测试

## 79. Journey 1 — Notification → Truth → Reminder

```text
Notification
→ SourceObservation
→ Normalize
→ Candidate
→ Truth
→ TruthDependencyIndex
→ Plan Trigger
→ Condition
→ Reminder
→ Verification
→ Record
```

验证：去重、用户确认、Fact provenance、重复通知抑制。

## 80. Journey 2 — Gmail API → Periodic Summary

```text
Gmail OAuth
→ READ_EMAIL
→ Observation
→ Truth
→ Scheduled Trigger
→ Window Aggregate
→ Summary
→ Result
```

验证：Scope、Token refresh、Freshness、AI 只总结 Truth。

## 81. Journey 3 — Vehicle Mileage → Predictive Prepare

```text
Vehicle odometer Observation
→ Truth
→ maintenance dependency
→ deterministic forecast
→ prepare service reminder/checklist
→ Record
```

验证：Provider-neutral Fact、预测可解释。

## 82. Journey 4 — Refund Silent Follow Up

```text
Refund status
→ Observation
→ Truth versions
→ no change = silent
→ completed
→ Result/Record
```

验证：状态变更、静默、终态。

## 83. Journey 5 — Approval → Network Loss → Reconciliation

```text
ActionIntent
→ R3 Approval
→ Execute
→ network loss after possible provider acceptance
→ OUTCOME_UNKNOWN
→ Reconciliation
→ operation lookup/read-back
→ final Result
```

验证：绝不双执行。

## 84. Journey 6 — Device/Permission Revoked → Restored

```text
Connection healthy
→ device permission revoked
→ health invalid
→ plan BLOCKED
→ new signed device proof / regrant
→ health restored
→ plan resumes
```

验证：fail-closed 与恢复链。

---

# 第三十二部分：测试门禁

## 85. 每批开发固定门禁

必须包含：

- Schema Unit Test
- Service Unit Test
- DB Integration Test
- Concurrency Test
- Migration Test
- API Contract Test
- Mobile Typecheck
- Mobile Test
- Full API Test
- Full Monorepo Test
- Build
- MySQL 8.4 Migration
- Backup / Restore
- Android Candidate Build

但继续执行“连续开发、里程碑集中验收”，不因为一个普通失败等待人工开工指令。

## 86. Runtime 特有测试矩阵

额外增加：

- Provider Capability truth table tests
- Manifest revision compatibility
- Grant revoked while execution pending
- Health changes during execution
- Observation duplicate storm
- Candidate concurrent confirmation
- Truth conflict
- stale truth rejection
- dependency index correctness
- resolver deterministic ranking
- risk floor cannot downgrade
- approval snapshot invalidation
- verification timeout
- outcome unknown no unsafe retry
- reconciliation exactly-once
- audit/provenance completeness

---

# 第三十三部分：Observability / SLO

## 87. 关键指标

按 Provider / Capability / Scenario / Strategy / Lifecycle Step 维度统计：

### Acquisition

- observation ingest rate
- provider error rate
- source freshness
- webhook lag
- notification parse success

### Truth Quality

- candidate confirmation rate
- conflict rate
- duplicate merge rate
- stale truth rate
- multi-source corroboration rate

### Runtime

- trigger latency
- condition evaluation latency
- resolver no-candidate rate
- approval waiting time
- execution success rate
- `OUTCOME_UNKNOWN` rate
- reconciliation resolution time

### Product

- Plan active rate
- silent follow-up avoided notifications
- actions saved
- user confirmations requested
- false positive / reject rate

## 88. Trace

所有 Lifecycle Step 都必须带：

- traceId
- correlationId
- executionId
- planVersionId
- userId（日志中脱敏/安全处理）
- providerKey/capabilityKey（适用时）

---

# 第三十四部分：安全 / 隐私 / 合规原则

## 89. Data Minimization

- 只收集 Scenario/Capability 需要的数据
- 不因“已连接 App”而默认读取全部数据
- Notification 原文默认不上传/不长期存储，优先结构化候选与 hash
- AppRead Session 必须显式用户启动或已明确授权的安全模式

## 90. Fail Closed

以下任意无法判断时不得继续高风险动作：

- Grant 不明确
- Health 不明确
- Capability 不明确
- Risk 不明确
- Approval Snapshot 不匹配
- SideEffect outcome unknown 且无法确认

## 91. Explicit Denial 是运行规则，不只是 UI 文案

Provider Manifest 中明确禁止能力必须由 Resolver 硬拦截。

## 92. Trusted Device

复用当前设备签名链，AppRead / Notification / Device-originated Observation 必须带可信设备证据。

---

# 第三十五部分：性能与规模设计

## 93. 不扫描所有 Plan

Truth Dependency Index 负责 event-driven wakeup。

## 94. Observation / Truth 分层存储

- Observation：高吞吐、可按 retention 清理
- Candidate：中期决策实体
- Truth：长期、版本化、低频高价值
- Audit：append-only

## 95. Worker 分工

建议逻辑角色：

```text
Acquisition Worker
Normalization Worker
Truth/Dependency Worker
Execution Worker（现有）
Reconciliation Worker
Notification/Record Worker
```

初期可以同进程不同 queue，规模扩大再独立部署；不要为了架构图提前引入过多服务。

---

# 第三十六部分：后续开发批次总路线

## 96. Milestone 0 — Architecture Freeze

交付：

- 本文作为主规划基线
- 命名冻结
- 领域/场景/策略/生命周期语义冻结
- 新增模块规则冻结
- Non-goals / Hard Stop 冻结

验收：不再出现“某领域单独 Engine”或“Provider 直接写进 Plan”的新设计。

## 97. Batch 1 — Capability Foundation

### 交付

- `ProviderCapabilityManifest`
- `ProviderCapabilityEvidence`
- `ConnectionCapabilityGrant`
- `ProviderCapabilityHealth`
- Manifest revision
- Four-dimensional runtime usability
- 首批 18 Provider Registry skeleton
- Admin/API read surface
- Mobile Connection Detail 读取真实状态

### 建议代码位置

```text
packages/connector-sdk/src/capability-manifest.ts
apps/api/src/provider-capabilities/*
packages/database/... migration set 1
```

不要把 Registry 塞成一个巨大 `switch`。

### 完成标准

给定 `provider + capability + connection + user`，系统可以确定：

```text
官方有没有
我们有没有实现
用户有没有授权
现在能不能用
为什么不能用
```

## 98. Batch 2 — Scenario / Resource Foundation

### 交付

- 96 `ScenarioDefinition`
- Resource Catalog
- Fact Schema Registry
- 8 `StrategyProfile`
- Reality / Readiness enum
- Scenario readiness API
- ScenarioPlanCompiler 第一版

### 完成标准

任何一个 Scenario 都能通过 Registry 回答所需 Fact、Source、Strategy、Risk、Action、Reality，而不是前端硬编码。

## 99. Batch 3 — Reality Pipeline

### 交付

- `SourceObservation`
- `NormalizerRegistry`
- `ParserRegistry`
- `DedupePolicyRegistry`
- `CandidateFact`
- Generic Truth service
- Freshness / Conflict / Provenance
- 当前 Notification billing 链迁移为 Generic Pipeline Adapter

### 关键迁移原则

现有 mobile billing 路径不得删除后重写；先做兼容 Adapter + 双路径测试，再切换默认消费入口。

### 完成标准

至少三种不同 Resource：

```text
finance.transaction
shipment.status
digital_account.connection.health
```

能走同一 Observation→Candidate→Truth pipeline。

## 100. Batch 4 — Android Foreground Acquisition

### 交付

- app_read_sessions
- app_read_session_events
- Foreground Guard
- Foreground Service
- Heartbeat
- Session timeout/cancel
- Notification / Share events 接 Observation
- Mobile Session UI

### 不做

- 自动 Accessibility 点击
- 万能页面 Agent
- 后台隐蔽采集

## 101. Batch 5 — Strategy Runtime + Dependency Index

状态：已完成，详见 [Batch 5 开发报告](./runtime-productization-batch-5-report.md)。

### 交付

- 8 StrategyProfile 正式参与 Plan compile/runtime
- Trigger profile
- Condition AST
- Operator Registry
- Truth Dependency Index
- 8 Golden Scenario tests

### 完成标准

8 种 Strategy 各有一条完整 15 步可追踪闭环。

## 102. Batch 6 — Capability Resolver

### 交付

- CapabilityRequirement
- Hard Filter
- Ranker
- Fallback Candidates
- Resolution Decision persistence
- Explainability
- Cost/latency/reliability hooks

### 完成标准

Plan 不依赖 Provider 名称，也能选择正确 Source/Action Provider。

## 103. Batch 7 — Risk / Approval / Execution Integration

### 交付

- effective risk floor
- context elevation
- approval immutable snapshot
- invalidation rules
- ActionIntent
- ActionAdapter
- Existing Execution Runner integration

### 完成标准

现有 Execution Engine 不重写，所有新 Action 都通过统一入口。

## 104. Batch 8 — Verification / Result / Reconciliation

### 交付

- VerificationPolicyRegistry
- verification_evidence
- Result model
- first-class OUTCOME_UNKNOWN
- reconciliation_cases
- Reconciliation Worker
- Consumer unknown-state UX

### 完成标准

Journey 5 网络中断测试能够证明“不会重复外部副作用”。

## 105. Batch 9 — Provider Group 1 真接入

2026-09-12 显式执行修订：[用户执行指令归档](./runtime-productization-execution-revision-2026-09-12.md)。先以 b679250 冻结 Batch 6～8 完成基线并完成远端完整 CI 收口，再依次执行：

1. Batch 9A — Provider Runtime Common Layer：统一 ProviderAdapter 生命周期、错误映射、RateLimit / Quota / Retry / Health / Verification Policy、Official Evidence Revision；复用既有凭据、Manifest / Grant / Health 和 Execution / Verification / Reconciliation，不创建平行运行链。
2. Batch 9B — Gmail：READ_EMAIL_METADATA / READ_EMAIL_BODY / READ_EMAIL_LABELS / CREATE_EMAIL_DRAFT / SEND_EMAIL；真实 OAuth、刷新与撤销、Observation → EmailMessage → Candidate → Truth、既有 Risk / Approval / Resolver / Execution、发送验证与未知结果保护。
3. Batch 9C — Google Calendar：READ_CALENDAR_EVENT / CREATE_CALENDAR_EVENT / UPDATE_CALENDAR_EVENT；标准 CalendarEvent；创建后按 eventId Read-back 比较 title / time / attendees。
4. Batch 9D — GitHub：Repository / Issue / PullRequest / Workflow；READ_REPOSITORY / READ_ISSUE / READ_PULL_REQUEST / READ_WORKFLOW_STATUS / CREATE_ISSUE / CREATE_COMMENT / Webhook；PR 长期静默跟踪 Golden Journey。
5. Batch 9E — Notion：READ_PAGE / READ_DATA_SOURCE / CREATE_PAGE / UPDATE_PAGE；Workspace / Page / DataSource 授权与写入 Read-back。
6. Batch 9F — Cross-Provider Journeys：Gmail 会议 → Truth → Calendar 创建与验证，以及 GitHub PR/Issue → Truth → Condition → Notion 工作记录更新与验证；必须证明共享 Resource / Fact / Strategy / Resolver / Execution，不以 Connector 数量替代验收。

Batch 9 完成后按下文 Batch 10 → 11 → 12 → 13 → 14 连续推进，无阶段停等；每批同步 schema / migration / service / API / unit / DB / concurrency / contract / Full API / monorepo / typecheck 等适用门禁与报告。真实平台能力、账号测试证据和 Mobile 遥测禁止伪造；缺少真实 Secret 或需真实账号高风险动作时按 Hard Stop 暂停相关链路。

- Gmail
- Google Calendar
- GitHub
- Notion
- 可附加 Google Contacts

每个 Provider 必须完成：

```text
official evidence
manifest
OAuth/grant
health
read/write capabilities
normalizer
verification
quota/error mapping
integration test
sandbox/test account evidence
```

## 106. Batch 10 — Wave 1 Scenario Reality

用 Group 1 Provider + Android Notification + internal/manual source，逐步把 Wave 1 约 35～40 场景提升到 `OBSERVE_READY / ASSISTED_READY`。

不是要求全部自动执行。

## 107. Batch 11 — Mobile Data-Driven Productization

- Connection Center 完全数据驱动
- Domain Workspace Registry 驱动
- Scenario Workspace
- Plan explanation
- 15-step consumer trace
- Reality/Capability gap UI
- Record / Audit 分层

## 108. Batch 12 — Provider Group 2/3/4 + Scenario Wave 2/3

按现实资格、官方开放度、用户价值逐步推进，禁止“为了数量做假的 Provider Connector”。

## 109. Batch 13 — Android Beta / Staging

重点验证：

- trusted device
- foreground acquisition
- notification source
- battery/process lifecycle
- permission revoke/restore
- session crash recovery
- real device observation quality

## 110. Batch 14 — Final Runtime RC Audit

最终重新跑：

- Full Gate
- MySQL 8.4 migration
- backup/restore
- Android candidate
- 6 Journeys
- security boundary audit
- provider manifest evidence freshness
- reality/status consistency

---

# 第三十七部分：实施优先级与依赖图

## 111. 核心依赖

```text
Capability Manifest ─────────────┐
                                ├→ Capability Resolver ─→ Execution
Connection Grant/Health ────────┘

Resource/Fact ─→ Observation ─→ Candidate ─→ Truth ─→ Dependency Index
     │                                      │
     └→ Scenario Definition ─→ Strategy ────┘

Execution ─→ Verification ─→ Result ─→ Reconciliation
                                  └→ Record/Audit
```

因此绝对顺序是：

```text
Capability Foundation
→ Scenario/Resource Foundation
→ Reality Pipeline
→ Strategy/Dependency
→ Resolver
→ Execution integration
→ Verification/Reconciliation
→ Provider scale-out
→ Scenario scale-out
```

AppRead 可以在 Reality Pipeline 后并行推进，但不能先于 Observation contract 自行发展。

---

# 第三十八部分：Hard Stop

## 112. 只有以下情况暂停相关链路

1. 生产数据存在不可逆损坏风险
2. 历史 PlanVersion / Audit 可能被不可逆破坏
3. 真实支付/发布/订单需要真实用户账号确认
4. Production Secret 缺失
5. 安全边界无法 fail-closed
6. Provider ToS / Official capability 无法确认且继续会产生违规风险

普通问题：

- test fail
- compile fail
- migration fail
- API fail
- UI fail

处理方式：

```text
定位 → 修复 → 回归 → 继续
```

不作为等待新开工指令的理由。

---

# 第三十九部分：当前明确不做

## 113. Non-goals

暂时禁止主线投入：

- 所有 App 强制内嵌运行
- 万能 Accessibility Agent
- 全手机 AI 自动点击
- 一次性接 18 个 Provider API
- 一次性做完 96 个真实场景
- 重写 Execution Engine
- 新建 Finance Engine / Vehicle Engine / Health Engine
- 每个 Source 建独立业务事实表
- 无限增加 Domain
- 为演示伪造“Provider Ready”
- 用 UI 状态冒充后端 Reality

---

# 第四十部分：本阶段最终验收标准

## 114. 系统必须能真实回答 10 个问题

对任意一条执行，必须从系统数据得到：

1. **这个数据从哪里来的？**
2. **Provider 官方到底允许什么？**
3. **懒人装甲现在真正实现了什么？**
4. **当前用户授权了什么？**
5. **这个数据什么时候观察到？是否还新鲜？**
6. **为什么认为它是真的？有哪些 Evidence / Provenance？**
7. **哪个 Plan 因为它被触发？条件为什么成立？**
8. **为什么选择这个执行方式/Provider？**
9. **外部动作到底成功没有？如何验证？**
10. **失败或未知以后系统如何处理？**

这 10 个问题全部能回答，才算从“自动化 App”升级为“可信现实世界自动化平台”。

## 115. 额外量化验收

至少达到：

- 19 Domain Registry 全部由后端/共享 schema 驱动
- 96 ScenarioDefinition 全部版本化存在
- 8 Strategy 各有 Golden Journey
- 15 Lifecycle Step 全链可追踪
- 至少 3 个 Resource 类型走 Generic Truth Pipeline
- 至少 4 个真实 Provider 完成 Production/Beta 真实连接验证
- Wave 1 至少 20 个场景达到 OBSERVE_READY 以上，再逐步推进到 35～40
- OUTCOME_UNKNOWN 有真实测试和 Reconciliation
- Connection 四层状态不再混淆
- Mobile 不再硬编码 Provider/Scenario Reality

---

# 第四十一部分：Batch 1 立即执行任务书

## 116. Batch 1A — 类型与 Registry

1. 在 Connector SDK 增加 `ProviderCapabilityManifest` 类型。
2. 增加 `ProviderAvailability`、`ImplementationStatus`、`ReviewStatus`、`RealtimeMode`、`DataBoundary`、`EvidenceRef`。
3. 保留现有 `ConnectorCapability` 兼容层；由 Manifest 生成运行 Capability，避免一次破坏所有 Connector。
4. 增加 manifest validator：
   - key format
   - resource names
   - scopes
   - risk floor
   - execute capability 必须 verification/side effect contract
   - unavailable capability 不得标 production ready
   - unknown official facts 必须 TO_VERIFY_OFFICIAL
5. 增加 manifest revision/hash。

## 117. Batch 1B — 数据库

新增 Migration Set 1 四张表；加 FK、unique、revision、append/supersede 规则。

不删除或重命名现有 connector_capabilities；第一阶段做投影/兼容。

## 118. Batch 1C — Provider Registry

建立 18 个 Provider skeleton。

每个 Provider 初始状态允许：

```text
TO_VERIFY_OFFICIAL
NOT_IMPLEMENTED
```

但不允许“空字段默认 AVAILABLE”。

## 119. Batch 1D — Capability Runtime Usability Service

实现：

```ts
resolveCapabilityUsability({
  userId,
  connectionId,
  providerKey,
  capabilityKey,
})
```

输出：

```json
{
  "providerAvailability": "AVAILABLE",
  "implementation": "BETA",
  "grant": "GRANTED",
  "health": "HEALTHY",
  "usable": true,
  "reasons": []
}
```

任何不可用必须提供机器码 + 消费者文案映射。

## 120. Batch 1E — API + Mobile

Connection Detail 改为真实 Capability API 驱动。

先不追求新的视觉页面；现有 UI 卡片直接显示四层状态。

## 121. Batch 1F — Tests

必须覆盖：

- official unavailable
- implementation missing
- scope partial
- grant revoked
- token expired
- health degraded
- rate limit
- provider unavailable
- explicit denial
- revision supersede
- fail-closed unknown

---

# 第四十二部分：开发过程中如何防止“96 场景失控”

## 122. 三个约束

### 约束一：新增 Scenario 不允许新增 Engine

只能新增：

- ScenarioDefinition
- Resource/Fact schema（必要时）
- Source/Action Adapter（必要时）
- Template
- Tests

### 约束二：新增 Provider 不允许修改 Scenario 核心逻辑

Provider 只能：

- Manifest
- Connector/Adapter
- Normalizer
- Verification
- Error mapping

如果接一个新 Provider 要改 20 个 Scenario Service，说明 Resource/Capability 抽象失败。

### 约束三：新增 Strategy 不允许绕开 Lifecycle

Strategy 只能修改 Profile 与默认政策，不能建立第二条执行主链。

---

# 第四十三部分：建议的仓库模块边界

## 123. Shared packages

建议保持少而清晰：

```text
packages/connector-sdk
  capability-manifest
  provider contracts
  side-effect contracts

packages/plan-schema
  product-model
  scenario-registry
  strategy-registry
  resource-catalog
  fact-schema
  condition-ast
  lifecycle contracts
```

不建议现在再拆十几个 npm package。

## 124. API generic modules

```text
provider-capabilities/
observations/
candidates/
truth-store/          // 扩展现有
capability-resolver/
verification/
reconciliation/
app-read/
```

Domain modules如 Billing/Logistics/Study/Device 保留为：

- Facade
- Scenario support
- adapter compatibility

但不能继续演化成独立 Engine。

---

# 第四十四部分：最终产品心智

完成这一阶段以后，用户看到的是：

> “我想让装甲帮我管一件事。”

系统内部实际做的是：

```text
识别 Scenario
→ 选 Strategy
→ 检查所需 Facts
→ 发现/建议 Sources
→ 检查 Provider 官方能力
→ 检查懒人装甲实现
→ 请求必要授权
→ 建立 PlanVersion
→ 持续获取现实 Observation
→ 形成可信 Truth
→ 只唤醒依赖该 Truth 的 Plan
→ deterministic Trigger/Condition
→ Risk/Approval
→ Resolve 最合适 Capability
→ Existing Execution
→ Verify
→ Result
→ Reconcile if unknown
→ Consumer Record + Audit
```

用户不需要理解 19/96/8/15，但系统必须完整使用它们。

**19 个领域**让产品易理解；  
**96 个场景**让需求可标准化；  
**8 种策略**让行为可复用；  
**15 个步骤**让每次自动化可信、可解释、可恢复。

这四层合起来，才是“懒人装甲”的真正产品内核。

---

# 第四十五部分：最终冻结的开发顺序

```text
1. Provider Capability Manifest
2. Provider Registry
3. Scenario Registry
4. Resource / Fact Catalog
5. Generic Source Observation
6. Normalize / Dedupe
7. Generic Candidate
8. Generic Truth
9. AppReadSession
10. 8 Strategy Runtime
11. Trigger Dependency Index
12. Capability Resolver
13. Risk / Approval Integration
14. Existing Execution Integration
15. Verification
16. Result / OUTCOME_UNKNOWN
17. Reconciliation
18. Record / Provenance
19. Provider 真接入
20. Scenario Reality 分波升级
21. Mobile 数据驱动产品化
22. Android Beta / Staging
23. Final Runtime RC Audit
```

此顺序作为统一运行时产品化阶段的默认执行顺序。只有 Hard Stop 才暂停相关链路；普通工程失败按“定位→修复→回归→继续”处理。

---

## 附录 A：最关键的设计原则清单

1. Plan 依赖 Resource/Fact/Capability，不直接依赖 Provider。
2. Provider Manifest 必须区分官方 Availability、Implementation、Grant、Health。
3. 不确定的 Provider 能力一律 `TO_VERIFY_OFFICIAL`。
4. Observation 不等于 Truth。
5. Candidate 不等于 Truth。
6. Truth 必须版本化、有 Freshness、有 Provenance。
7. AI 负责理解/生成，不负责绕过 deterministic runtime。
8. 8 Strategy 是 Profile，不是 8 个 Engine。
9. 15 Lifecycle 是唯一执行骨架。
10. Risk Floor 不可被 Plan/AI 降级。
11. Approval 必须绑定不可变动作快照。
12. Request sent != business success。
13. `OUTCOME_UNKNOWN` 是一等结果。
14. Unknown side effect 不可盲重试。
15. Reconciliation 独立运行。
16. Record 给用户，Audit 给系统。
17. AppRead 先会话控制，再逐级增加读取能力。
18. 不为 19 个领域创建 19 套 Engine。
19. 不为 96 个场景创建 96 个 Service 链。
20. 不为展示效果伪造 Production Reality。

## 附录 B：每个 PR / Batch 的架构检查问题

提交前必须回答：

- 是否进入统一主链？
- 是否新增了重复概念/表？
- 是否让 Plan 绑定了 Provider？
- 是否把 Observation 当 Truth？
- 是否存在 fail-open？
- 是否绕开 Risk/Approval？
- 是否重造 Execution 能力？
- 是否有 Verification？
- 是否正确处理 OUTCOME_UNKNOWN？
- 是否有完整 provenance？
- 是否有真实 Journey test？
- UI 是否来自后端 Reality 而非硬编码？

若任一答案不符合，优先修正架构再继续扩功能。
