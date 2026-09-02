# 懒人装甲 Lazy Armor

> **从从容容，游刃有余。**
>
> **想偷什么懒，定个计划。**

**懒人装甲是一个个人事务自动化平台。**

它不是为了让用户拥有更多功能，而是希望让用户**少做更多事情**：把高频、重复、低价值、需要反复记忆、操作、沟通和跟进的事务，转换成可以长期运行的「懒人计划」。

系统能自动完成的事情尽量自动完成；正常成功尽量保持安静。只有当事情异常、需要确认、权限失效，或者确实需要用户处理时，再把用户叫回来。

懒人装甲不是：

* AI 聊天机器人
* 普通提醒软件
* 单一财务 App
* 单一内容发布工具
* 单一车辆 / 设备管理 App
* 传统商城
* 大型 ERP

它的核心只有一个：

# 计划

---

## 一个懒人计划是怎么工作的

用户可以从「懒人计划库」直接**装上**模板，也可以通过自然语言描述自己的需求。

例如：

> 以后每个月话费超过 150 元再告诉我。

系统不会把自然语言直接变成任意代码。

AI 只负责理解意图和生成受控 Draft，最终仍然必须进入正式 Plan Definition。

```text
用户意图 / 模板
      ↓
  Plan Draft
      ↓
用户配置与授权
      ↓
 PlanVersion
      ↓
    启用
      ↓
  Execution
      ↓
 Today / Record
```

底层所有领域共享同一条自动化主链：

```text
Source
  ↓
Trigger
  ↓
Condition
  ↓
Action
  ↓
Risk
  ↓
Approval
  ↓
Execution
  ↓
Result
  ↓
Fallback
  ↓
Audit
```

无论是账单、快递、学习、内容、车辆、设备还是工作事项，都不能绕过这条主链另建一套自动化系统。

---

# 消费者端只有五个一级入口

懒人装甲不会因为领域越来越多，就把首页变成十几个业务入口。

| 入口     | 作用                         |
| ------ | -------------------------- |
| **今天** | 看真正需要处理的事情、异常、摘要和系统已经处理的结果 |
| **计划** | 管理正在运行、需要设置或已经暂停的懒人计划      |
| **＋**  | 从模板或自然语言创建新的计划             |
| **记录** | 查看系统过去实际做了什么               |
| **我的** | 管理连接、权限、设备、车辆、通知、隐私和安全记录   |

「计划」内部按照消费者理解组织为四大区：

### 我的生活

家庭、住房、快递、补给、出行、娱乐等。

### 我的钱

账单、消费、订阅、异常、财务摘要等。

### 我的事情

工作、内容、学习、运营等。

### 我的东西

车辆、手机、电脑、家电、设备、数字账号等。

正常成功默认保持静默。

Today 不应该成为信息流。

---

# 代表性懒人计划

首批 Canonical Plans 用少量真实场景证明同一套 Plan Engine 可以解决不同领域的问题。

1. **月度账单汇总**
   自动整理账单、分类、汇总，并发现明显变化。

2. **话费异常守护**
   正常账单保持安静，超过阈值或明显异常时再通知。

3. **快递静默管家**
   正常运输不打扰，长时间停滞、异常时提醒，签收后归档。

4. **家庭补给提醒**
   根据消耗周期、上次购买和使用情况准备补货清单。

5. **视频一稿多发**
   一个 MasterContent 生成不同平台的 PlatformVariant，并进入 Prepare Publish / Approval / Connector。

6. **每日重要事项摘要**
   从邮件、日历等来源提炼真正需要用户处理的事情。

7. **考试学习计划**
   根据考试日期、学习时间和进度生成结构化计划，并支持遗漏重排。

8. **设备耗材提醒**
   围绕设备、耗材和维护周期形成长期计划。

在此基础上，懒人计划继续扩展到：

* 水电气 / 宽带账单
* 会员与订阅防浪费
* 工作跟进
* 日历冲突
* 文件整理
* 学习进度
* 车辆保险 / 年检 / 保养
* 数字账号到期
* 家庭周期事项
* 经营摘要
* 库存异常
* 出行准备

但这些能力始终复用统一 Plan Engine。

---

# 核心架构原则

## 1. 一个 Plan Engine，而不是多个领域系统

领域模块只能扩展：

* Connector
* Template
* Action Definition
* Domain Data Profile
* Domain Presentation

禁止复制：

* 独立任务引擎
* 独立审批系统
* 独立通知引擎
* 独立自动化 Worker
* 独立幂等机制

---

## 2. PlanVersion 不可变

已经创建的历史 PlanVersion 不修改。

计划发生变化时：

```text
Current PlanVersion
        ↓
Create New Version
        ↓
Apply / Enable
```

每一次 Execution 永久关联当时实际运行的 PlanVersion。

历史不是“当前配置的副本”，而是真实发生过的事实。

---

## 3. 外部副作用必须经过安全链

任何可能影响外部世界的动作，都不能由 Mobile、AI 或领域代码直接调用 Provider。

正式链路至少包括：

```text
Runtime Permission
        ↓
Risk
        ↓
Approval（需要时）
        ↓
Idempotency
        ↓
SideEffectOperation
        ↓
Transactional Outbox
        ↓
Provider
        ↓
Result / Recovery
        ↓
Audit
```

支付、转账、高价值购买、账户权限变化、重要外部数据删除、大规模公开发布等高风险动作，在完整 Production Gate 通过前必须保持关闭。

---

## 4. 历史只能追加，不能篡改

以下内容属于历史事实：

* PlanVersion
* Execution
* Execution Step
* SideEffectOperation
* Audit

系统采用 **forward-only migration**。

禁止通过以下方式“解决问题”：

* DROP 正式历史表
* TRUNCATE 正式数据
* reset schema
* destructive startup migration
* demo seed 覆盖正式数据
* 修改历史 PlanVersion
* 修改历史 Execution identity
* 修改 Audit

---

## 5. 正常成功尽量安静

产品默认遵守：

> **能不打扰就不打扰，能不让用户操作就不让用户操作；但越自动，后台越必须安全、透明、可追踪、可撤销。**

正常成功通常进入 Record。

真正需要用户处理的事情才进入 Today。

---

# AI 在懒人装甲里的位置

AI 是理解和生成辅助，不是安全决策者。

AI 可以：

* parsePlanIntent
* generatePlanDraft
* summarizeExecution
* classifyTransaction
* adaptContent
* generateDraft

AI 永远不能：

* 判断用户身份
* 决定或降低 Risk
* 绕过 Approval
* 绕过 Runtime Permission
* 直接调用高风险 Connector
* 修改历史 PlanVersion
* 修改历史 Execution
* 修改 Audit
* 直接支付或转账
* 直接改变账户权限

AI 输出最终必须进入：

**受控 Schema + 正式 Plan Engine。**

---

# Connector 与生产能力

懒人装甲通过统一 Connector Framework 接入外部数据和服务。

包括但不限于：

* Email
* Calendar
* File
* Webhook
* Billing
* Logistics
* Cloud Storage
* Content Platform
* Device
* Vehicle

每个 Provider 都必须明确自己的能力：

* read
* write
* OAuth
* refresh
* webhook
* idempotency
* operation lookup
* rate limit
* sandbox
* SideEffectContract
* production availability

生产能力必须明确区分：

* `PRODUCTION_READY`
* `BETA`
* `DRAFT_ONLY`
* `DISABLED`

## 开发完成 ≠ 生产启用

代码已经存在，并不代表能力已经允许在生产环境真实执行。

如果缺少：

* 稳定官方 API
* Production Credential Provider
* Runtime Permission
* Approval
* Idempotency
* SideEffectContract
* Outbox
* Recovery
* Audit
* 真实 Production Evidence

对应能力必须继续保持关闭。

详见：

[P2 Provider Capability Matrix](docs/P2_PROVIDER_CAPABILITY_MATRIX.md)

---

# 技术栈

懒人装甲采用 TypeScript Monorepo。

* **Monorepo**：pnpm + Turborepo
* **Mobile**：Expo + React Native + Expo Router
* **API**：NestJS
* **Admin / Operations**：Next.js
* **Database**：MySQL + Drizzle ORM
* **Queue / Worker**：Redis + BullMQ
* **Validation**：Zod + class-validator
* **Testing**：Vitest + Integration Tests
* **Android**：Expo / EAS + Native Android Release Pipeline

---

# 仓库结构

```text
lazy-armor/
├─ apps/
│  ├─ api/
│  │  ├─ API
│  │  ├─ Execution Worker
│  │  └─ Outbox Worker
│  │
│  ├─ mobile/
│  │  └─ 消费者 App
│  │
│  └─ admin/
│     └─ Operations / Admin
│
├─ packages/
│  ├─ config/
│  ├─ connector-sdk/
│  ├─ database/
│  ├─ plan-schema/
│  └─ shared/
│
├─ infra/
│  └─ 本地基础设施
│
├─ docs/
│  └─ 开发、审计、验收和生产就绪文档
│
└─ artifacts/
   └─ 构建证据 / Metadata
```

新的 APK / AAB 等二进制构建产物不应继续提交到源码 Git。

---

# 本地开发

## 环境要求

* Node.js 20+
* pnpm 9+
* Docker Desktop / Docker Engine

## 安装依赖

```bash
pnpm install
```

## 启动 MySQL / Redis

```bash
pnpm docker:up
```

## 配置环境变量

复制：

```text
.env.example → .env
```

至少正确配置：

```text
DATABASE_URL
REDIS_URL
JWT_SECRET
CREDENTIAL_MASTER_KEY
APP_ENV
EXPO_PUBLIC_APP_ENV
EXPO_PUBLIC_API_URL
```

不要把真实 Secret、Token、OAuth Credential 或 Android Keystore 密码提交到 Git。

## 数据库 Migration

```bash
pnpm db:migrate
```

Migration 必须保持：

```text
forward-only
```

## 启动开发环境

```bash
pnpm dev
```

也可以分别启动：

```bash
pnpm --filter @lazy-armor/api dev
pnpm --filter @lazy-armor/admin dev
pnpm --filter @lazy-armor/mobile dev
```

默认开发 API：

```text
http://127.0.0.1:3001/api
```

Health：

```text
/api/health
```

---

# 独立 Worker

API、Execution Worker 和 Outbox Worker 支持独立进程运行。

构建：

```bash
pnpm --filter @lazy-armor/api build
```

分别启动：

```bash
pnpm --filter @lazy-armor/api start:api

pnpm --filter @lazy-armor/api start:execution-worker

pnpm --filter @lazy-armor/api start:outbox-worker
```

Standalone Worker 提供独立：

```text
/live
/ready
```

用于检查：

* Worker Process
* MySQL
* Redis
* BullMQ
* Worker readiness

---

# 测试与质量 Gate

常用命令：

```bash
pnpm typecheck
pnpm test
pnpm build
```

开发过程优先运行：

* affected tests
* focused integration tests
* security regression
* migration checks

集中 Full Regression 只在重要 Gate 运行，例如：

* P0 Hardening
* P1
* P2
* P3
* P4 Beta
* P5
* Final Release Candidate

涉及以下能力的修改必须保持专项安全测试：

* Auth / Session
* Credential
* Permission
* Risk
* Approval
* PlanVersion immutability
* Execution / Audit append-only
* Idempotency
* Transactional Outbox
* Side Effect Recovery
* Webhook replay / retention
* Worker restart / fault recovery

---

# Development / Staging / Production

项目明确区分部署环境。

Backend：

```text
APP_ENV=development
APP_ENV=staging
APP_ENV=production
```

Mobile：

```text
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_APP_ENV=staging
EXPO_PUBLIC_APP_ENV=production
```

Staging / Production 使用 **fail-closed** 原则。

例如：

* API URL 必须使用 HTTPS
* 禁止 localhost
* 禁止 `127.0.0.1`
* 禁止 `10.0.2.2`
* Staging / Production Redis 必须使用 `rediss://`
* Staging / Production 分别固定使用 `lazy-armor-staging` / `lazy-armor-production` 键前缀
* Production 禁止 Debug Signing
* 缺 Android 正式 Signing 时 Release 必须失败
* Production Credential 不允许回落到开发本地文件 Provider

部署配置模板分别见 `.env.staging.example` 与 `.env.production.example`。模板只描述变量形状，所有 secret 必须由部署平台的 Secret Manager 注入；当前未注册托管 Credential Provider 时，staging/production API 会拒绝启动。

生产风险不会因为代码已经完成而自动开放。

---

# 开发路线

项目采用 P0～P5 连续开发模型。

```text
P0 — Foundation & Production Hardening
P1 — Representative Plans
P2 — Real Connector & Integration Layer
P3 — Domain Expansion
P4 — Productization & Beta
P5 — Commercialization & Scale
```

开发与验收分离。

完成一个 Workstream 后继续下一项，只有以下 Hard Stop 才暂停相关链路：

* 数据可能损坏
* destructive migration
* PlanVersion immutable 被破坏
* Execution / Audit 被删除
* Credential / Token 泄漏
* 用户数据越权
* Approval 被绕过
* Risk 可被客户端降低
* Idempotency 失效
* Outbox 原子性失效
* 领域绕过 Plan Engine
* 未授权真实高风险动作

普通问题：

```text
修复 / Backlog / Deferred Gate
              ↓
            继续开发
```

---

# 实时开发状态

README 不再维护容易快速过期的：

* 当前测试数量
* 最新 Migration 编号
* 当前小 Workstream
* 下一条开发任务
* 临时 Deferred Gate

这些统一维护在：

## [CONTINUOUS_DEVELOPMENT_STATUS.md](docs/CONTINUOUS_DEVELOPMENT_STATUS.md)

---

# 重要文档

* [持续开发状态](docs/CONTINUOUS_DEVELOPMENT_STATUS.md)
* [P0 Final Audit](docs/P0_FINAL_AUDIT_REPORT.md)
* [P1 Development Report](docs/P1_DEVELOPMENT_REPORT.md)
* [P2 Development Report](docs/P2_DEVELOPMENT_REPORT.md)
* [P2 Provider Capability Matrix](docs/P2_PROVIDER_CAPABILITY_MATRIX.md)
* [P3 Development Report](docs/P3_DEVELOPMENT_REPORT.md)
* [P4 Development Report](docs/P4_DEVELOPMENT_REPORT.md)
* [P5 Development Report](docs/P5_DEVELOPMENT_REPORT.md)
* [Production Readiness Checklist](docs/PRODUCTION_READINESS_CHECKLIST.md)

---

# 最终目标

懒人装甲最终追求的不是：

> “功能很多”

也不是：

> “所有事情都自动化”

真正的目标，是让适合自动化的事务能够**长期、可靠、安静地被处理掉**。

同时让用户始终知道：

* 系统正在替我做什么
* 使用了什么数据
* 拥有什么权限
* 什么情况下会先问我
* 出错以后发生了什么
* 我能不能暂停
* 我能不能撤销
* 我能不能追溯

> **懒人装甲真正的价值，是把那些本来需要你反复操心的事情，变成可以放心交出去的计划。**
