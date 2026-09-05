# 懒人装甲 Lazy Armor

> 从从容容，游刃有余。

**懒人装甲（Lazy Armor）** 是一个以「懒人计划（Plan）」为核心的个人自动化平台。

它的目标不是堆叠 AI 功能，也不是再造一套复杂的生活管理软件，而是把生活与工作中高频、重复、低价值的事务，变成可以被系统理解、持续跟进、自动执行或半自动执行的计划。

核心价值：

- 省时
- 省力
- 省步骤
- 省沟通
- 省记忆
- 省风险

AI 主要负责理解、生成、整理和编排辅助。

真正的系统核心是：

- Plan Engine
- Connector / Connection
- Source / Truth
- Risk / Approval
- Execution
- Verification
- Fallback
- Record / Audit

---

## 懒人装甲是什么

传统自动化工具往往从“功能”出发：

- 创建一个提醒
- 设置一个定时任务
- 写一个脚本
- 接一个 API
- 建一个工作流

懒人装甲从“用户真正想少操心的一件事”出发。

例如：

```text
每月话费快到期时提醒我
快递到驿站后告诉我，不要每条物流消息都提醒
每天把真正重要的事情整理成一份摘要
家里的滤芯快到更换周期时提醒我
一段视频处理好以后，帮我准备多个平台的发布内容
发现家庭常用物品快用完时提醒补货

这些都不是独立的小功能。

它们统一被表达为：

懒人计划（Plan）

核心：懒人计划

Plan 是懒人装甲最核心的产品单位。

一个 Plan 描述：

从哪里获得信息
↓
什么时候触发
↓
满足什么条件
↓
准备做什么
↓
有没有风险
↓
是否需要用户确认
↓
如何执行
↓
如何确认执行结果
↓
失败以后怎么办
↓
最后如何记录

因此，系统不按照：

财务系统
物流系统
车辆系统
家庭系统
设备系统
内容系统

分别建立独立自动化引擎。

所有领域统一运行在同一套 Plan Engine 上。

核心价值

懒人装甲不是追求“功能越多越好”。

每一个 Plan 都应该至少帮助用户减少一种成本：

操作成本

少点几次。

少开几个 App。

少重复填写。

时间成本

少查询。

少等待。

少手工整理。

记忆成本

系统持续跟进。

用户不需要一直记着。

决策成本

系统先整理信息。

真正需要决定的时候再找用户。

沟通成本

减少重复确认、询问和催促。

风险成本

该确认的事情必须确认。

该停止的事情必须停止。

不能因为“自动化”而扩大风险。

核心执行链

懒人装甲只有一条核心执行主链：

Source
→ Trigger
→ Condition
→ Action
→ Risk
→ Approval
→ Execution
→ Result
→ Fallback
→ Audit

各业务领域不得绕过该主链自行建立独立执行系统。

真实世界数据链

真实数据进入系统以后，不会直接触发高价值动作。

推荐的数据链：

Source
↓
Raw Data
↓
Normalize
↓
Candidate
↓
Validation / Deduplication / Freshness
↓
Truth
↓
Plan
↓
Capability Resolver
↓
Action
↓
Verification
↓
Record / Audit

核心原则：

收到一条数据，不代表它就是真实事实。

例如：

收到“快递已到驿站”通知

并不一定意味着：

当前这个快递现在确实还在等待取件

它可能是：

重复通知
延迟通知
历史通知
多账号混淆
多个来源重复描述同一件事

所以必须先经过 Candidate / Truth 层。

Source

Source 是系统感知真实世界的入口。

来源可以包括：

官方 API
Webhook
Android 系统能力
Android Notification
App Share
文件
图片
截图
Gmail
Calendar
物流 Provider
智能家居 Provider
车辆 Provider
本地设备
用户手工输入

来源本身不会决定业务逻辑。

Plan Engine 消费的是经过标准化的数据、事件和事实。

Android App Discovery

懒人装甲 Android 客户端支持从设备上发现真实可用 App。

基本流程：

Android PackageManager
↓
Installed / Launchable Apps
↓
Device App Identity
↓
Capability Detection
↓
Generic App Connection
↓
Optional Enhanced Adapter

核心原则：

发现 App ≠ 连接 App ≠ 获得 App 私有数据。

Android App Sandbox 仍然存在。

懒人装甲不会因为知道某个 App 已安装，就自动获得该 App 的私有数据库。

App 可连接能力

不同 App 可能提供不同能力：

App
├─ Installed
├─ Launchable
├─ Notification
├─ Share
├─ Intent / Deep Link
├─ Official API
├─ OAuth
├─ Accessibility
└─ Vision Assisted

连接不是简单的：

connected = true

而应该明确：

当前允许懒人装甲对这个 App 做到什么程度。

例如：

淘宝

设备
✓ 已安装
✓ 可以启动

数据
✓ 通知
○ 分享
× 官方 API

动作
✓ 打开 App
✓ 打开链接
× 自动支付

当前能力
Notification Connected
数据源优先级

系统应优先选择更稳定、更可信的数据来源。

推荐优先级：

S1 官方 API / Webhook
↓
S2 OS / Device API
↓
S3 Notification / Share / File
↓
S4 Accessibility Structured Read
↓
S5 Screenshot / Vision
↓
S6 Manual Assisted

低等级数据源不能被描述成高可信、实时、官方数据。

Truth Store

Truth Store 用于保存系统当前认为可信的事实或状态。

例如：

当前剩余话费
某快递当前状态
某设备当前耗材状态
某账单当前应付金额
某计划当前所依赖的真实状态

Truth 不应该只有：

value = 100

还应该保留来源信息：

value
source
provider
collectedAt
observedAt
confidence
freshness
verified
evidence

从而回答：

这个数据从哪里来的？
什么时候获取的？
现在还新不新？
有没有其他来源冲突？
Capability Resolver

Plan 不应该关心具体使用：

Gmail
Android Notification
某汽车 API
某个 App
Home Assistant

Plan 只描述自己需要的能力。

例如：

读取订单状态
发送提醒
打开导航
获取设备状态
创建日历事件

Capability Resolver 根据当前环境选择实际能力。

考虑因素包括：

是否可用
是否授权
Reality Level
可靠性
风险
用户偏好
Provider Health
设备在线状态
数据新鲜度
成本
延迟
Action

懒人装甲不把“发出请求”直接当作成功。

动作等级可以包括：

E0 INTERNAL
E1 API
E2 SYSTEM / INTENT / DEEP LINK
E3 ACCESSIBILITY
E4 VISION ASSISTED
E5 USER ASSISTED

例如：

点击“提交订单”

不代表：

订单已经成功创建

系统应该尽可能验证真实业务结果。

Verification

任何有外部副作用的动作，都应该尽量回答：

到底成功了没有？

执行状态不应该只有：

SUCCESS
FAILED

而应该允许：

PLANNED
RESOLVING_CAPABILITY
WAITING_PERMISSION
WAITING_APPROVAL
PREPARED
EXECUTING
VERIFYING
SUCCEEDED
RETRYING
FALLBACK
USER_ASSISTED
OUTCOME_UNKNOWN
FAILED

特别是：

OUTCOME_UNKNOWN

非常重要。

如果外部系统可能已经成功，但系统没有收到确认：

不允许盲目重复执行。

否则可能产生：

重复订单
重复消息
重复付款
重复发布
重复写入
重复设备操作
Risk & Approval

自动化不能绕过风险控制。

懒人装甲的原则不是：

能自动就全部自动。

而是：

低风险尽量减少打扰，高风险必须获得充分授权。

典型风险包括：

金钱变化
账户权限变化
对外发布
真实订单
删除
身份信息变化
门锁
车辆控制
外部不可逆操作

Risk Engine、Approval 和 Temporary Authorization 统一存在于执行主链。

Side Effect Safety

真实世界动作最危险的问题之一是：

同一件事情被执行两次。

因此系统包含针对 Side Effect 的安全机制，例如：

Idempotency
Unique Identity
Execution Lease
Transaction
Transactional Outbox
Claim
Retry Policy
Verification
Reconciliation
Audit

目标不是追求理论上的“所有地方 exactly once”，而是在现实系统中尽可能保证：

不会因为并发
不会因为 Worker 重启
不会因为网络超时
不会因为重复消息
不会因为用户重复点击

而把同一个外部动作重复执行。

Trusted Device

懒人装甲支持一个账号拥有多个可信 Android 设备。

关系类似：

User
├─ Android Device A
├─ Android Device B
└─ Android Device C

每台设备拥有独立的可信身份。

当前 Trusted Device 能力包括：

独立设备身份
Public Key
Challenge
Signature Proof
Short-lived Device Session
Signed Request
Replay Protection
Device Revoke

服务端不能因为一个普通 API 请求，就把任意客户端当成可信设备。

Account & Device Model

一个账号可以拥有多个设备。

未来设备模型将逐步统一覆盖：

Phone
Tablet
PC
Home Bridge
Vehicle Bridge
Other Edge Device

目标模型：

Account
↓
EdgeDevice
↓
Device Capability
↓
Plan
↓
DeviceTask
↓
Execution
↓
Evidence / Result

但当前完整的跨设备 EdgeDevice / DeviceTask 调度体系仍在开发中。

目前 Trusted Device 的重点仍然是 Android。

Notification

Android Notification 是懒人装甲非常重要的现实数据入口。

流程：

Android Notification
↓
Notification Listener
↓
Generic Normalizer
↓
Raw Source
↓
Candidate
↓
Truth
↓
Plan

通知适合获得：

快递变化
订单变化
账单提示
手机运营商提醒
银行通知
设备通知
App 状态提醒

但 Notification 并不等于官方 API。

系统必须明确来源 Reality Level。

Accessibility

Accessibility 只应作为受控自动化能力使用。

原则：

用户明确授权
+
App Allowlist
+
Capability Allowlist
+
Plan Authorization
+
Risk Policy
+
必要时 Approval

Accessibility 不应被设计成：

“授权以后懒人装甲可以随便操作手机。”

高风险操作必须继续受 Risk / Approval 控制。

Vision

Screenshot / Vision 属于后备数据与操作能力。

典型用途：

用户打开一个账单页面
↓
截图
↓
Vision
↓
识别金额 / 日期 / 状态
↓
Candidate

Vision 结果天然比官方 API 可信度低。

因此必须保留：

Evidence
Confidence
Source
Freshness
Household

家庭不是独立的自动化引擎。

家庭能力建立在统一资源与权限体系上。

核心概念包括：

Household
Person
Membership
Relationship
Ownership
Delegation
Approval Policy

家庭关系不自动代表权限。

例如：

父亲
母亲
配偶
孩子

只是关系。

真正能不能：

查看
修改
操作
审批

必须由权限和授权决定。

Lazy Mall

懒人商城不是一个独立于懒人装甲的传统商城系统。

它更适合作为：

Plan 的 Commerce / Service / Connector 空间。

例如：

家庭补给状态
↓
Plan
↓
准备购买
↓
查询商品 / 库存 / 价格
↓
预算 / 偏好 / 风险
↓
用户确认
↓
创建订单
↓
验证订单
↓
物流跟踪
↓
Record / Audit

Plan Engine 不应该绕过 Commerce Connector 直接修改商城业务状态。

支付和高风险交易必须保持严格确认边界。

计划领域

懒人计划可覆盖多个长期领域。

当前统一领域模型包括：

finance
life
family
health
social
pet
housing
travel
entertainment
work
operations
content
study
identity_docs
government
legal_contract
vehicle
device
digital_account

这些领域只用于：

分类
展示
模板
数据组织
体验设计

它们共享同一套：

Plan Engine
Connector
Risk
Approval
Execution
Truth
Audit

不会为每个领域重新创建独立 Engine。

Reality Level

懒人装甲区分“看起来能用”和“真实已经接通”。

所有能力应该尽量标记现实等级。

Level	含义
NOT_IMPLEMENTED	尚未实现
FIXTURE	测试固定数据
MANUAL	用户手工输入
INTERNAL_REAL	系统内部真实闭环
DEVICE_REAL	真实设备数据或能力
SANDBOX	Provider Sandbox
PROVIDER_BETA	Provider 测试 / Beta
PRODUCTION_REAL	生产真实能力

基本规则：

UI、代码、文档和验收报告不得把低 Reality Level 描述成更高等级。

例如：

手工填写车辆里程

不能描述成：

实时车辆数据
Sandbox 订单

不能描述成：

生产订单
当前真实能力

当前仓库已经形成完整的自动化基础架构。

Plan Engine

已具备：

Plan
Immutable PlanVersion
Current / Active Version
Canonical Definition
Definition Hash
Source
Trigger
Condition
Action
Plan State
Template Install
Plan Draft
Plan Execution
Result
Fallback
Audit
Execution

已具备：

Execution
Execution Step
Execution Event
Worker
Execution Lease
Queue
Retry
Fallback
Result Resolution
Approval Gate
Runtime Connection Guard
Side Effect

已具备：

Idempotency
Side Effect Coordinator
Transactional Outbox
Outbox Worker
External Delivery Adapter
Claim / Retry
Immutable published state protection
Security

已具备：

Authentication
Refresh Session
Credential Provider
Encrypted Local Credential Provider
Webhook Signature Verification
Temporary Authorization
Risk Engine
Approval
Safe Logging
Sensitive Snapshot Sanitization
Append-oriented Audit
Android

已具备真实 Android Native Bridge。

包括：

Device App Bridge
Installed App Discovery
App Information
Open App
Open URI
Notification Listener
Generic Notification Normalizer
Notification Source Connection
Trusted Device
Device Request Signing
Replay Protection
Truth

已具备：

Candidate
Truth Store
Provenance
Source Resolver
Truth concurrency protection
Source-aware execution support
Connectors

已有统一 Connector 基础设施：

Connector SDK
Connector Registry
Connection
Credential
Capability
Webhook
Provider Guard
Rate Limit
Circuit Breaker
Consumer Product

移动端已经具备：

Authentication
Onboarding
Today
Plans
Plan Detail
Plan Edit
Records
Connections
Add Connection
Notification Source
Trusted Device
Permission
Domains
Membership
Device
Vehicle
Commerce
Data Management
Security Activity
Admin

仓库包含独立 Admin 应用，用于内部运营和管理能力。

当前尚未完成

当前项目仍处于：

持续开发 + 真实设备验收阶段

并不是 Production Ready。

以下能力仍需继续完成或深化。

Android 真机验收

包括：

多设备真实注册
Revoke
Replay Attack
Expired Session
Account Isolation
App Discovery
Notification Permission
Notification → Candidate → Truth
真机完整 Plan Journey
Edge Device

尚未完整建立：

通用 EdgeDevice
DeviceCapability Registry
Heartbeat
Device Online State
DeviceTask
Foreground Task
Offline Task Policy
Capability Resolver across devices
Push

仍需完整生产化：

Server
→ Push Provider
→ Device
→ User Action
→ Plan / Approval / Result
Gmail

已有相关 Connector / Integration 基础，但生产级 Gmail Provider 连接仍需要继续完成和验证。

Google Calendar

已有相关连接和集成基础，但完整生产级能力仍需要继续验收。

Logistics

当前具备物流领域和相关 Plan 基础。

后续重点是：

更多真实 Provider
数据源优先级
状态一致性
Provider Beta / Production Reality
Home

后续计划的真实能力优先级：

Matter / Vendor API
↓
Home Assistant
↓
MQTT / LAN
↓
Android Bridge
↓
Manual

高风险设备动作，例如门锁，必须继续进入 Risk / Approval。

Vehicle

后续真实能力优先级：

OEM API
↓
OBD-II
↓
Vehicle / Head Unit Bridge
↓
Phone Bluetooth / Notification
↓
Manual

手工数据不得冒充实时车辆数据。

Accessibility

计划继续建设：

App allowlist
Capability allowlist
Structured Read
Controlled Action
Foreground Requirement
Risk Boundaries
Evidence
Verification
Vision

计划继续建设：

Screenshot ingestion
OCR / Vision extraction
Structured candidate
Evidence
Confidence
Verification
Privacy Center

还需要继续完善：

Data Inventory
Data Source
Connected Accounts
Device Permissions
Household Visibility
Retention
Export
Revoke
Delete
Audit
Repository Structure
lazy-armor/
├─ apps/
│  ├─ api/
│  │  └─ NestJS backend / workers
│  │
│  ├─ mobile/
│  │  └─ Expo / React Native / Android Native Bridge
│  │
│  └─ admin/
│     └─ Next.js internal admin
│
├─ packages/
│  ├─ config/
│  ├─ connector-sdk/
│  ├─ database/
│  ├─ plan-schema/
│  └─ shared/
│
├─ docs/
│  ├─ STATUS.md
│  ├─ TASK_BOOK.md
│  ├─ ANDROID_TRUSTED_DEVICE_ACCEPTANCE.md
│  ├─ ANDROID_APP_DISCOVERY.md
│  ├─ MIGRATION_RELEASE_EVIDENCE.md
│  └─ ROLLBACK_PROCEDURE.md
│
├─ infra/
│  └─ docker/
│
├─ scripts/
│  ├─ migration safety
│  ├─ repository hygiene
│  ├─ production truth gate
│  ├─ MySQL verification
│  └─ Android verification build
│
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ turbo.json
Technology Stack
Backend
Node.js
TypeScript
NestJS
MySQL 8
Drizzle ORM
Mobile
React Native
Expo
Expo Router
Android Native Kotlin Bridge
Admin
Next.js
React
TypeScript
Monorepo
pnpm
Turborepo
Infrastructure
MySQL
Redis
Docker
GitHub Actions
Local Development

推荐环境：

Node.js 20+
pnpm
MySQL 8
Redis
Java / Android SDK（Android 开发）
Install
pnpm install
Environment

根据环境准备配置。

仓库提供：

.env.example
.env.staging.example
.env.production.example

不要把真实密钥提交到 Git。

Start Local Infrastructure
docker compose -f infra/docker/docker-compose.yml up -d
Database Migration
pnpm migrate

生产数据库禁止：

DROP
TRUNCATE

Migration 必须通过安全检查。

Development
pnpm dev
Testing

基础检查：

pnpm typecheck
pnpm test
pnpm build
Repository Hygiene
pnpm repository:hygiene
Production Data Truth
pnpm production:data-truth
Migration Safety
pnpm test:migrations
CI / Release Gates

GitHub Actions 是当前正式工程门禁的一部分。

主要门禁包括：

Repository Hygiene
↓
Production Data Truth
↓
Dependency Audit
↓
MySQL Migration
↓
Typecheck
↓
Focused Regression
↓
Full Monorepo Tests
↓
Backup / Restore
↓
Full Build
↓
Android Verification Artifact

CI 全绿是进入真实设备和发布验收的必要条件。

但：

CI 全绿 ≠ 产品已经 Production Ready。

真实 Provider、真实手机、真实权限和真实业务动作仍然需要独立验收。

Android Verification

Android 验证构建：

pwsh -File scripts/android-verification-build.ps1

Android 构建产物不提交到源码仓库。

正式验证产物应保存为：

Local temporary artifact
GitHub Actions Artifact
Release Artifact

不应提交：

APK
AAB
build metadata
temporary verification output

到 main。

Database Migration Policy

数据库 Migration 是不可随意重写的历史。

已经进入主分支的 migration：

0000
0001
0002
...

不能为了“看起来整洁”而重新合并。

原则：

Existing migration append-only
不回写历史 migration
不随意重命名
不 DROP / TRUNCATE
多 DDL migration 使用正确 statement breakpoint
必须通过 migration safety gate
必须能够在 MySQL 目标版本实际执行
Security Principles

懒人装甲涉及用户真实生活与真实外部动作。

因此安全边界属于产品核心，而不是后期补丁。

主要原则：

Fail Closed

权限、身份或结果不明确时：

不继续高风险动作。

Least Privilege

一个 Connection 只拥有完成当前能力所必需的最小权限。

Explicit Authorization

高风险能力不能因为“App 已安装”就自动获得。

Replay Protection

设备签名请求不能被简单重放。

Idempotency

同一个外部副作用不能因为重复请求而重复执行。

Verification

发送请求并不等于业务成功。

Audit

关键行为必须能够追踪：

谁
什么时候
通过什么来源
为什么
做了什么
结果是什么
Secret Protection

禁止把：

API Key
OAuth Token
Credential
Private Key
Production Password

提交到仓库。

Privacy Principles

数据应区分普通数据和敏感数据。

敏感数据例如：

Token
API Key
身份证件
银行相关信息
健康数据
合同原文
Provider Credential

敏感数据应：

加密
最小权限访问
保留访问审计
设置合理保留期
支持撤销
支持删除
避免进入普通日志
Consumer UX Principles

懒人装甲面向用户的界面不应该大量暴露内部工程术语。

用户更关心：

发生了什么？
为什么找我？
你准备做什么？
最后成功了吗？
我需要做什么？

而不是：

Execution #2839
Connector timeout
Policy R3
Candidate ID

内部复杂度应尽量由系统承担。

Messages / Attention

系统不应把所有自动化事件都变成通知轰炸。

用户注意力可以区分：

SILENT
RECORD_ONLY
DIGEST
NORMAL
IMPORTANT
URGENT
APPROVAL_REQUIRED

真正应该主动打扰用户的通常是：

需要审批
需要支付
需要确认
权限失效
连接异常
执行结果未知
高风险动作
用户明确要求提醒

普通完成事件可以只进入 Record 或 Digest。

Mobile Information Architecture

长期移动端结构以“连接的真实世界 + 懒人计划”为核心。

左侧连接区域可以包含：

消息
懒人装甲
懒人商城
──────────
常用连接
──────────
更多连接
──────────
其他 App
──────────
添加连接
──────────
账号

Android 设备上的 App 应尽量自动发现。

未连接 App 不需要全部展开显示。

推荐折叠为：

▦ 其他 App  86

用户进入后再进行：

搜索
查看能力
授权
建立连接
忽略
Development Status

当前主线不是继续创造新的阶段编号。

P0～P5 已经作为历史开发阶段完成了大量基础工程建设。

后续开发以：

真实世界接入、真实设备、真实数据、真实动作、产品化和发布验收

为主。

当前连续路线：

CI Green
↓
Android Trusted Device Real-device Acceptance
↓
Installed App Discovery
↓
Generic App Connection
↓
Real Notification
↓
Candidate
↓
Truth Store
↓
Plan Resolver
↓
Plan Execution
↓
Messages / Record / Audit
↓
Revoke / Multi-account / Security Acceptance
↓
Mobile Consumer Productization
↓
Logistics
↓
Push
↓
Gmail
↓
Google Calendar
↓
Household / Person / Relationship / Resource / Delegation
↓
Lazy Mall
↓
Home
↓
Vehicle
↓
Device / Digital Account
↓
Intent / DeviceTask
↓
Controlled Accessibility
↓
Vision
↓
Privacy / Ops / Observability
↓
Android Beta + Staging
↓
Final RC Audit
Hard Stop

持续开发过程中，普通：

Test Failure
Type Error
Migration Error
CI Failure
Build Failure

应直接：

定位
→ 修复
→ 回归
→ 继续

只有以下情况才属于真正 Hard Stop：

Production Data Risk

存在不可逆生产数据破坏风险。

Real Secret / External Account

需要真实生产密钥、真实第三方账号或不可代替的用户授权。

Security Boundary Failure

发现无法继续安全执行的核心安全边界问题。

其他模块不应因为单一链路 Hard Stop 而全部停止。

Documentation

当前长期维护文档：

docs/STATUS.md
docs/TASK_BOOK.md
docs/ANDROID_TRUSTED_DEVICE_ACCEPTANCE.md
docs/ANDROID_APP_DISCOVERY.md
docs/MIGRATION_RELEASE_EVIDENCE.md
docs/ROLLBACK_PROCEDURE.md

历史阶段报告不再作为当前工程状态来源。

当前真实状态统一以：

代码
+
数据库 Migration
+
自动化测试
+
GitHub Actions
+
真实设备 / Provider 验收证据

为准。

Current Release Position

当前项目已经拥有较完整的自动化平台基础，包括：

Plan Engine
Truth Store
Connector
Trusted Device
Risk
Approval
Execution
Side Effect Safety
Audit
Android Native Bridge
Mobile Product Foundation

但仍然必须区分：

基础架构已经建立

和：

真实世界生产能力已经全部完成

这两件事。

当前项目仍在继续推进真实设备、真实数据源、真实 Provider 和真实执行闭环。

Project Principle

懒人装甲最终追求的不是：

“这个 App 有很多功能。”

而是：

用户把事情交给系统之后，可以少操心。

系统应该尽可能做到：

该知道的时候知道
该处理的时候处理
不该打扰的时候不打扰
需要用户决定的时候再找用户
做完以后能够证明真的做完了

这才是懒人装甲真正要解决的问题。

懒人装甲 Lazy Armor

让重复的事情少占时间。

让复杂的事情少占脑子。

让真正重要的事情，留给用户自己决定。



