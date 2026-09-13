# 统一运行时产品化执行修订 — 2026-09-12

本文件是用户 2026-09-12 明确指令的原文归档，与总规划 v1.0 一起构成开发基线。发生执行顺序冲突时，以本次明确修订为准；不降低原有 Hard Stop、fail-closed、不可变历史与非破坏性迁移要求。

下面为本次用户请求原文，不是图片中的示例能力声明，也不是已完成验收报告。

先完成当前基线收口与推送

以本地 b679250 为 Batch 6～8 完成基线。

确认工作区 clean。

推送到 GitHub main。

跑完整远端 CI。

重点重新验证 Production Dependency Audit、Migration、MySQL 8.4、Full API、Monorepo Test、Build、Mobile、Android。

普通失败直接修复、回归、继续，不回退 Batch 6～8。

只有远端完整通过后才写 FULL GREEN。

Batch 6～8 从此只允许 bugfix，不再改变核心架构。

Batch 9A — Provider Runtime Common Layer

这是所有真实平台的统一接入层，必须先做，避免 Gmail、微信、淘宝各写一套。

统一 Provider 生命周期：


Official Evidence
→ Manifest
→ Authorization
→ Credential
→ Grant
→ Health
→ Read / Execute
→ Verification
→ Result / Reconciliation
统一 Provider Adapter：

TypeScript

interface ProviderAdapter {
  authorize(): Promise<AuthorizationResult>;
  refresh(): Promise<CredentialResult>;
  revoke(): Promise<void>;

  health(): Promise<ProviderHealth>;

  read(input: ReadRequest): Promise<ReadResult>;

  execute(input: ExecuteRequest): Promise<ExecuteResult>;

  lookupOperation?(input: OperationLookupRequest): Promise<OperationLookupResult>;

  subscribe?(input: SubscribeRequest): Promise<SubscriptionResult>;

  verify(input: VerificationRequest): Promise<VerificationResult>;
}
统一错误类型：


AUTH_EXPIRED
AUTH_REVOKED
SCOPE_MISSING
RATE_LIMITED
QUOTA_EXCEEDED
PROVIDER_UNAVAILABLE
RESOURCE_NOT_FOUND
PERMISSION_DENIED
NETWORK_ERROR
TIMEOUT
OUTCOME_UNKNOWN
同时建立：
ProviderRateLimitPolicy、QuotaPolicy、RetryPolicy、HealthPolicy、VerificationPolicy、ProviderErrorMapping、Official Evidence Revision。

DoD：新增 Provider 时原则上不需要改 Scenario、Strategy、Plan Engine、Execution Engine。

Batch 9B — Gmail 真实接入

Gmail 作为第一条真实 Provider 闭环。

第一版只做：


READ_EMAIL_METADATA
READ_EMAIL_BODY
READ_EMAIL_LABELS

CREATE_EMAIL_DRAFT
SEND_EMAIL
必须打通：


Google OAuth
→ Scope
→ Credential Refresh
→ Connection
→ Grant
→ Health
→ Gmail API
→ SourceObservation
→ EmailMessage
→ Candidate
→ Truth
→ Strategy Runtime
发送链：


ActionIntent
→ Risk
→ Approval
→ Capability Resolver
→ Gmail Adapter
→ Existing Execution
→ Verification
→ Result
必须测试 Token 过期、Scope 缺失、撤销授权、429、网络断开、重复执行保护、OUTCOME_UNKNOWN。

Batch 9C — Google Calendar 真实接入

重点实现：


READ_CALENDAR_EVENT
CREATE_CALENDAR_EVENT
UPDATE_CALENDAR_EVENT
建立标准资源：


CalendarEvent
创建后必须 Read-back：


create
→ eventId
→ GET eventId
→ title/time/attendees 比较
→ VerificationEvidence
第一条真实场景可以是：


Gmail 会议邮件
→ 提取时间
→ 用户确认
→ 创建 Calendar Event
→ 验证
Batch 9D — GitHub 真实接入

第一版资源：


Repository
Issue
PullRequest
Workflow
能力优先：


READ_REPOSITORY
READ_ISSUE
READ_PULL_REQUEST
READ_WORKFLOW_STATUS
CREATE_ISSUE
CREATE_COMMENT
同时接 Webhook。

Golden Journey：


PR 状态变化
→ Observation
→ Truth
→ SILENT_FOLLOW_UP
→ merged / failed
→ 通知
这部分重点验证长期状态跟踪，而不是一次性动作。

Batch 9E — Notion 真实接入

第一版：


READ_PAGE
READ_DATA_SOURCE
CREATE_PAGE
UPDATE_PAGE
重点测试：
Workspace 授权、Page/DataSource 权限、读取、写入、Read-back Verification。

Golden Journey：


工作摘要
→ 生成内容
→ 用户确认
→ 写入 Notion
→ 重新读取
→ 验证
Batch 9F — Cross-Provider Journeys

这一阶段决定 Batch 9 是否真正成功。

至少完成两条：


Gmail
→ 识别会议
→ Truth
→ Google Calendar 创建日程
→ Verification
→ Record
和：


GitHub PR / Issue
→ Truth
→ Condition
→ Notion 更新工作记录
→ Verification
→ Record
目标不是证明有4个 Connector，而是证明：


不同 Provider
→ 同一 Resource / Fact
→ 同一 Strategy
→ 同一 Resolver
→ 同一 Execution
Batch 10 — Wave 1 Scenario Reality

Batch 9 后不要再建 Engine，开始批量提升 Scenario Readiness。

第一波重点领域：


finance
daily_life
family
work
content
vehicle
device
digital_account
优先场景：


财务：
账单、余额、预算、订阅、退款、异常交易

日常：
快递、缴费、补给、订单跟进

工作：
重要邮件、会议、待办、工作摘要

内容：
内容准备、发布提醒、发布结果跟踪

车辆：
保养、保险、年检、里程

设备：
耗材、保修、设备状态、续费

数字账户：
OAuth 到期、授权撤销、账号异常、会员续费
每个场景必须有：


ScenarioDefinition
Resource / Fact
Source Requirement
Strategy
Truth Policy
Capability Requirement
Risk
Verification
Fallback
Mobile Presentation
Readiness 自动计算：


CATALOG_ONLY
MANUAL_READY
OBSERVE_READY
ASSISTED_READY
AUTOMATED_READY
BLOCKED_PROVIDER
BLOCKED_IMPLEMENTATION
Batch 10 第一目标不是96个全部自动化，而是先让约35～40个核心场景进入真实可用状态。

Batch 10 同步完成 8 Strategy Golden Journeys

必须分别找现实场景验证：


STATE_GUARD
→ 余额 / 设备状态

EXPIRY_GUARD
→ 保险 / 保修

ANOMALY_DETECTION
→ 异常交易

SILENT_FOLLOW_UP
→ 退款 / 快递 / PR

PERIODIC_SUMMARY
→ Gmail 工作摘要

PREDICTIVE_PREPARE
→ 车辆保养

ASSISTED_ACTION
→ Calendar 创建事件

AUTOMATED_ACTION
→ 低风险、可验证、已预授权动作
Batch 11 — Mobile Data-Driven Productization

这时正式落地之前设计的产品级页面。

不再堆一级页面，重点补二级、三级页面：


/domains/:domain/:scenario
/strategies
/strategies/:strategy
/templates
/templates/:templateId

/plans/:id/lifecycle
/executions/:id/lifecycle

/truth/:id
/candidates/:id

/connections/:id/capabilities
/connections/:id/capabilities/:key

/reconciliation
/reconciliation/:id
页面必须全部数据驱动。

场景详情读取：


ScenarioDefinition
Required Facts
Existing Facts
Capability Gaps
Supported Strategies
Readiness
Templates
Running Plans
Capability 详情读取：


官方开放
已实现
已授权
当前健康
Truth 详情读取：


当前值
Reality
Freshness
Evidence
Provenance
Version History
Dependent Plans
15步页面读取真实 LifecycleTrace，而不是画15个固定状态。

Batch 12 — Provider Group 2 / 3 / 4 + Wave 2 / 3

Group 2：


YouTube
X
Discord
Telegram
Group 3：


抖音
快手
Group 4：


微信
支付宝
淘宝
京东
B站
小红书
Instagram
同时扩展：


housing
travel
study
pet
social
identity_docs
operations
最后再进入：


health
government
legal_contract
entertainment
高风险动作
官方能力不明确时：


TO_VERIFY_OFFICIAL
禁止因为 App UI 能看到数据，就声明官方 API 可用。

Batch 13 — Android Beta / Staging

集中验证真实手机环境：


Trusted Device
AppReadSession
Foreground Guard
Heartbeat
Notification
Share Receiver
Permission revoke
Permission restore
Device offline
Process death
Battery optimization
App foreground switching
Timeout
Cancel
记录真实指标：


Session 成功率
Observation 成功率
Parser 成功率
Timeout Rate
Crash Rate
Permission Failure
Battery Impact
这一阶段仍然不要把“万能 Accessibility 自动点击”作为主线。

Batch 14 — Final Runtime RC Audit

最终重新跑完整门禁：


Unit
Schema
DB Integration
Concurrency
Migration
API Contract
Full API
Monorepo
Typecheck
Build
MySQL 8.4
Backup / Restore
Android Candidate
Provider Integration
Security
Production Dependency Audit
最终随机拿一条 Execution，系统必须能完整回答：


数据从哪里来？
为什么可信？
哪个 Truth？
为什么触发？
为什么条件成立？
为什么选择这个 Provider？
为什么要/不要审批？
有没有真正执行成功？
成功证据是什么？
结果未知怎么办？
最终 Record / Audit 在哪里？
开发代理现在直接执行的指令

以 b679250 作为 Batch 6～8 完成本地基线。

第一步：
推送当前 clean commit，完成远端 CI 收口。
普通 CI 失败直接定位、修复、回归并继续，不回退 Batch 1～8。

第二步：
立即执行 Batch 9 — Provider Group 1 Real Integration。

固定顺序：
Provider Runtime Common Layer
→ Gmail
→ Google Calendar
→ GitHub
→ Notion
→ Cross-Provider Journeys

不得重写 Plan Engine、Strategy Runtime、Risk、Approval、
Execution、Verification、Reconciliation。

新增 Provider 只能通过：
Manifest
+ Adapter
+ Evidence
+ Grant
+ Health
+ Normalizer
+ Verification
+ Error Mapping
接入统一运行时。

Batch 9 完成后连续推进：
Batch 10 Wave 1 Scenario Reality
→ Batch 11 Mobile Data-Driven Productization
→ Batch 12 Provider/Scenario 扩展
→ Batch 13 Android Beta/Staging
→ Batch 14 Final Runtime RC。

除既定 Hard Stop 外，不阶段停等。
现在后续路线已经很明确：Batch 9 开始接真实平台，Batch 10 把场景变真，Batch 11 把前端变成真正的数据驱动产品。 这三批是接下来最关键的开发阶段
