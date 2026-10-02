# 懒人装甲 VNext v4.0：160 场景、17 步计划生命周期与真实世界执行能力——前后端一体化升级总方案

**修订日期**：2026-09-25  
**参考代码**：`964896765/lazy-armor` / `fix/rc-full-gate-real-db-concurrency@c626e10cca37d9441b705a7a5a34fcbce7a3dbae`（本次核对时的远端 HEAD）  
**参照主分支**：`main@e8646a256a0ce83868be4565f135ca35cbab450e`  
**状态**：目标设计与增量开发任务书；不代表 160 场景、17 步产品流程、私密保险库、云端浏览器和全部真实跨应用能力已经实现。  
**前序材料**：《总开发规划 v3.0》《后续开发任务书 v3.0》《VNext 最终整合方案（2026-09-25）》、本项目后续关于事实获取、执行策略、Plan Offer、17 步生命周期、160 场景、极简 UI、私密、商城及手机 App 交互的讨论。

> **这次修订的关键纠偏：**上一版把“96 场景与 15 步保持不变”写成了最终业务目标，遗漏了已经讨论过的“**19 领域稳定、160 场景目标、17 步外层 Plan Lifecycle**”。同时，它对后端的事实需求、来源选择、有效性过滤、决策编排、动作提供者、跨端执行与验证收口不够深入。本版补足这些能力，同时**不删掉**仓库已有的 96 canonical 场景、8 个策略键、15 步执行内核。新 17 步是贯穿从用户选场景到持续重算可用性的**外层产品/计划生命周期**；原 15 步是一次真实执行的**内层运行生命周期**，不是二选一。

---

## 0. 唯一产品目标与架构红线

### 0.1 产品目标

懒人装甲是以用户“管理对象”和“懒人计划”为核心的个人生活操作系统，不是聊天机器人壳、Notion 仿制品、纯 RPA 或泛商品商城。使用者只需要说明希望系统了解什么、希望得到什么结果、允许在哪些边界内执行；系统据此生成**可兑现**的计划，持续取得**有效数据**，做出可解释判断，选定真实可用的执行方式，完成或交接操作，再以证据验证效果。成功指标是确实减少用户的重复查询、填报、记忆、跨 App 切换与无效打扰，而不是目录数量和模型调用量。

### 0.2 五个不变与六个升级

- **不变一：**19 个稳定领域，现有 96 个 canonical 场景的 `key/revision/hash`、已安装模板、既有计划与历史审计不被修改。
- **不变二：**保留 8 个已经注册的 StrategyProfile 键；升级面向用户的策略表达，但不能静默重写历史定义。
- **不变三：**保留内部 15 步 Execution Lifecycle、单一 Plan/Truth/Risk/Approval/Execution/Verification/Reconciliation/Audit 权威链。
- **不变四：**现有 NestJS + Connector/Provider + Android + MySQL/Redis + MCP/Skills/AgentAdapter 是可扩展基础；除有明确收益与退出方案外不建立第二套引擎。
- **不变五：**Production Gate 没有真实通过之前，不能开放无授权的外部高风险操作，也不能用 fixture/sandbox 宣称真实可用。
- **升级一：**场景目录从 **96 已有 → 160 规划**，新增 64 个通过真实 Fact/Action Contract 唯一性评审的场景；以后继续版本化扩展，而不将 160 视为上限。
- **升级二：**引入明确的 **17 步 Plan Lifecycle**，与内层 15 步保持映射关系。
- **升级三：**将计划设置拆成**计划模式/目标、业务操作与策略图、执行授权等级**三个维度，使“分析、总结、跟进、执行”有可判断的输入、输出和成功条件。
- **升级四：**建立需求驱动的 **Fact Demand → Source Resolution → Capture → Semantic Relevance → Evidence/Candidate → Truth** 获取能力，拒绝垃圾通知和伪数据。
- **升级五：**建立 **Decision → Action Demand → Action Resolution → Provider/Device/Web/User Handoff → Verification → New Truth** 的可执行闭环，区别“找到数据”与“有权且有能力采取行动”。
- **升级六：**将极简移动端、用户本地“私密”、计划驱动商城、多设备和云端浏览器组合成同一产品，不重复造 Plan 或 Auth。

### 0.3 状态、事实与权限是不同的

`ScenarioCatalog 可展示` ≠ `Product Capability 已实现` ≠ `当前用户已授权` ≠ `设备当前在线` ≠ `数据新鲜可靠` ≠ `动作允许执行` ≠ `实际结果已验证`。任何后端投影、AI 回复、前端卡片都必须保留这些差别。

---

## 1. 本次代码核对：真实基线、优势和缺口

### 1.1 仓库现状（已检查的具体源码）

- 代码仍以 `packages/plan-schema/src/product-model.ts` 提供 **19 领域/96 场景/8 策略/15 执行步骤**；`domain-catalog.ts` 的四个旧 group 实际为 `money/life/work/things`，其中文显示为“我的钱／我的生活／我的事情／我的物品”，与本轮商定的“我的财物／我的生活／我的事务／我的工作”不一致。必须做**展示映射**，不能批量重写历史 PlanVersion。
- `apps/api/src/ai-adapter/agent-planner.service.ts` 已具备有界提案、Scenario/Truth/Capability/Skill/MCP 上下文和结构化输出校验，但 `ai-adapter.module.ts` **当前装配 `FixtureAgentModel`**；因此不能把现有 Agent 基础误述为已经接通可用的多模型在线自主规划。
- `apps/api/src/capability-resolver/*`、`runtime-catalog/*`、`strategy-runtime/*`、`reality-pipeline/*`、`device-tasks/*` 已有权威与证据基础；下一步应增强这几个现有模块的请求和适配逻辑，而不是创建另一个“智能执行平台”。
- `apps/api/src/mcp/mcp-client.service.ts` 已限制外部 MCP 的只读快速调用，将带副作用调用要求回到现有 Plan/Execution；应保留这一边界，扩展成熟工具与异步任务适配。
- `apps/mobile/app/(tabs)/_layout.tsx` 仍通过 `ConnectionRail` 在左侧占用 64 像素，`(tabs)/scenarios.tsx` 仍以场景目录列表为主，与最终决定的顶部五入口、底部三操作键、首页“最近 + 计划树”不一致。
- `apps/mobile/app/(tabs)/commerce.tsx` 是待购买与目录展示的前端起点，还不是商品、支付、订单的完整真实链路。当前 `secure-token-store.ts` 只保存登录 token；服务端 `LocalEncryptedCredentialProvider` 是服务端加密库，二者都不是用户手机上完整的“私密”空间。
- `docs/r9-real-device-evidence-2026-09-22.md` 记录了真机安装、登录、可信设备注册、一次签名 heartbeat；通知监听未完成系统授权，Share 尚未实收验证，Observation→Candidate→Truth→Plan→Result 真机黄金链及断网/撤权/重复副作用仍待验收。

### 1.2 发布基线不可混淆

核对时，开发分支比 `main` 领先 **27 提交**；最近检查的 `main@e8646a2` workflow **Fast Gate 成功、RC Full 真实 DB 并发测试失败、Android Verification Artifact 构建失败**。开发分支在 PR/显式触发独立同 SHA 门禁前，不得推断它的 RC 已经通过。旧 v3.0 记录的是更早 `main@4fa547d`，对旧提交有效，不能覆盖后续实际失败。`main` 未开启分支保护，应加入必需检查、签名/审查与生产部署审批。

### 1.3 本次后端改造方向

将核心能力分为九个**复用既有实现的责任域**：Scenario & Resource Contracts、Fact Demand & Capture、Truth & Provenance、Plan Intelligence/Offer、Deterministic Decision、Action Capability、Policy & Approval、Durable Execution & Verification、Consumer Projection & Audit。这里的“域”是模块边界，不代表再建九套服务或九个数据库。

---

## 2. 目标总架构：个人实时世界模型 + 一套有界执行内核

```text
用户目标／首页领域场景／AI输入／模板／已有计划
                      │
          [Scenario + Resource/Object Contract]
                      │
             Fact Demand + Action Demand
                      │
     ┌───────────────┴────────────────┐
     │                                │
 [SourceResolver]                [ActionResolver]
     │                                │
API/Webhook | Android | Web      API/Intent | DeviceTask
通知/Share | 用户导入            Web Browser | Human Handoff
     │                                │
 Capture Scheduler                    │
     │                                │
相关性筛选/数据最小化                 │
     │                                │
Observation → Normalization → Candidate
     │
来源校验/版本/去重/身份匹配/冲突处理
     │
Evidence Ledger → Versioned Truth
     │
Agent 仅生成 Plan Offer/策略图提案
     │
Contract Validator + Deterministic Decision
     │
Risk / Policy / Immutable Approval
     │
Existing Execution / Outbox / DeviceTask / WebAdapter
     │
Read-back Verification → Reconciliation → New Truth
     │
Plan State / Recent / Records / Audit / Availability Recompute
     └─────────────────────────────────────────┘
```

坚持**运行时权威中心唯一**：`PlanVersion` 定义“应当做什么”，`TruthVersion` 定义“当前知道什么”，`Decision` 定义“为什么现在该做”，`Approval` 定义“授权做到哪里”，`Execution+Evidence` 定义“实际尝试与已核实结果”。AI、浏览器与手机仅能提出或承接这几个权威实体认可的需求，不能把网页截图、模型回答或设备回报直接伪装成业务成功。

---

## 3. 四大展示空间、19 领域与 160 场景：真正可扩展的目录

### 3.1 新的展示映射及场景规模

| 固定展示空间 | 归属领域（总计 19） | 已有 | 新增候选 | 目标合计 |
|---|---|---:|---:|---:|
| 我的财物 | 财务、住房、车辆、设备、数字账号 | 29 | 13 | **42** |
| 我的生活 | 日常事务、家庭、健康、社交关系、宠物、出行、休闲娱乐 | 32 | 25 | **57** |
| 我的事务 | 证件、政务、合同与法律事务 | 12 | 10 | **22** |
| 我的工作 | 工作、运营、内容创作、学习 | 23 | 16 | **39** |
| **合计** | **19** | **96** | **64** | **160** |

这是最终产品**规划分配**；现有 96 已从源码逐项核对，但 64 个为提议候选，尚须进行场景去重、真实来源可用性和合规评估。**不能为了达到 160 这个数字而将同一个场景的不同通知策略、提醒频率或同一数据字段包装成多个独立场景。**附录 A 给出 19 域完整基线和 64 条新增清单、建议 key，经过评审后再冻结新增 canonical registry。

### 3.2 Scenario Contract V2（实现可执行性，而不只是菜单）

每个场景应给出机器可校验的版本化定义：

`scenarioKey/revision`；`domainKey`；`resourceTypes`（包裹/交易/设备/账号等对象）；`userGoalSchemas`；`requiredFacts/optionalFacts`；`factFreshness`；`allowedSourceCapabilities`；`availableActionIntents`；`verificationContracts`；`riskBoundaries`；`recommendedStrategyGraph`；`planOfferPresets`；`readinessRules`；`privacyClasses`；`unsupportedConditions`；`fixtureVsRealEvidence`。

**资源实例（Resource/Subject）**与**场景类型（Scenario）**分离：快递场景是一种标准，用户的某个运单是一个 Subject，一个用户可创建两个不同运单/不同条件的计划，不需要复制注册场景。支持 `ScenarioRelation`（依赖、触发、互斥、资源共享）与 `ScenarioBundle`（一个用户目标关联若干计划），但不得将 Bundle 变成第二套调度器。

### 3.3 场景上线分级

一条场景从“目录上有”到“可对外承诺”依次为：`CATALOG_ONLY` → `CONTRACT_COMPLETE` → `DETERMINISTIC_SANDBOX` → `REAL_SOURCE_VERIFIED` → `REAL_ACTION_VERIFIED` → `BETA_ELIGIBLE` → `PRODUCTION_ELIGIBLE`。这些是建议的**治理状态**，不取代仓库已有 Reality Level，只作为汇总证据视图。每条场景单独给出 Source/Action/Verification 的真实性，不允许 160 个场景一次性显示“已支持”。

---

## 4. 正式 17 步 Plan Lifecycle：覆盖选择、获取、决策、执行和持续重算

**17 步是目标产品层闭环；代码里现有 15 步是每次执行的安全运行闭环。**外层可能跨越多天、多来源、多次执行；内层每次执行保持独立审计。明确规定各步的服务端产物、缺口状态及 UI 反馈：

| 步 | 生命周期阶段 | 最重要的服务端产物/门禁 | 用户能够理解的展示 |
|---:|---|---|---|
| 1 | **Domain：选定领域** | 固定 19 领域及规范 key，空间只做展示映射 | 选择生活/财物/事务/工作下的领域 |
| 2 | **Scenario：选定场景** | 160 目标目录的注册 revision、适用性 | 选择实际需求场景 |
| 3 | **Goal + Object：定义目标和管理对象** | `GoalSpec`、`ResourceSubject`、范围与时间窗 | 想让系统了解什么、对哪个包裹/账号/设备负责 |
| 4 | **Requirements：加载场景的事实、动作、验证契约** | `FactDemand/ActionDemand/VerificationContract` | 需要哪些信息、能做哪些事、怎样算完成 |
| 5 | **Capability Discovery：发现候选来源与动作能力** | API/设备/通知/网页/人工渠道注册与支持矩阵 | 哪些渠道技术上可能实现 |
| 6 | **Readiness：判断此用户当前可兑现度** | 当前授权、设备心跳、数据新鲜度、服务健康/费用 | 还差连接、权限、设备或新鲜数据中的哪一步 |
| 7 | **Plan Offers：生成多个可兑现方案** | `PlanOffer`（来源+策略图+操作+验证+费用+限制） | 可选方案与各自前提条件 |
| 8 | **Rank/Explain：解释方案差异** | 有界确定性评分、用户权重、不可越权约束 | 隐私、可靠性、费用、自动化程度差异 |
| 9 | **User Selection：用户选定及细化权限** | 选中 offer、确认需要的授权边界 | 选择方案，决定哪些操作需确认 |
| 10 | **User Plan：创建、编译并固定计划版本** | 现有 Draft→Compile→Immutable PlanVersion→Activation | 一份清晰的、可编辑新版本的正式计划 |
| 11 | **Truth Refresh：运行时持续获取有效事实** | Demand 驱动采集、Observation/Candidate/TruthVersion | 显示真实状态、来源与新鲜度 |
| 12 | **Decision：根据实时事实选择下一步** | 可重放的 `DecisionEnvelope`、解释、条件 AST | 为什么提醒、总结、继续等待或提出执行 |
| 13 | **Risk/Policy/Approval：判风险与请求必要同意** | 现有 Risk/Approval，不可变授权边界 | 哪个操作需要我的确认以及原因 |
| 14 | **Execution：在可用渠道执行或交接** | Existing Execution/DeviceTask/受控 Browser Adapter | 执行中、等待手机、等待用户或无法执行 |
| 15 | **Verification：以真实证据验证结果** | 回读/回执/业务终态；不确定进入 Reconciliation | 已完成/失败/结果待核实，不能猜成功 |
| 16 | **Today + Records：展示结果与可追溯历史** | 投影现有 Plan/Execution/Evidence/Audit | 首页最近、计划中心进度及完整记录 |
| 17 | **Availability Reconciliation：持续重算可用性并调整方案** | 权限、来源、价格、设备、Fact 变化触发重新评估；必要时提出**新 PlanVersion** | 原渠道不可用了，有没有合规替代方案 |

**外层循环：**第 17 步可以回到 5～8 步生成新的来源/动作方案，也可以在真实事实变化时回到 11～12 步；需要改变实质计划或授权时必须生成新版本/重新批准，绝不能在后台默默改写 active 版本。步骤 8 的排名只对**技术方案/操作能力**做满足约束的解释，不应伪装成可执行真实性的保证。

### 4.1 与现有内层 15 步的严格映射

现有源码中 `PLAN_EXECUTION_LIFECYCLE` 的 15 步**完整保留**：①确认连接与能力 ②获取现实数据 ③整理并去重 ④生成候选事实 ⑤确认为可信事实 ⑥判断触发 ⑦判断条件 ⑧判断风险 ⑨必要审批 ⑩选择执行方式 ⑪执行动作 ⑫验证真实结果 ⑬形成结果 ⑭回退/对账 ⑮记录与安全审计。外层 1～10 是创建/选择用户旅程；外层 11 对应内层 1～5；外层 12 对应 6～7；外层 13 对应 8～9；外层 14 对应 10～11；外层 15 对应 12～14；外层 16 消费 13～15；外层 17 在条件变化时开始下一轮，不新增与内核竞争的状态机。

---

## 5. 计划智能升级：不是让 AI 替代用户思考，而是把目标编译成真实操作

### 5.1 三维计划模型

1. **Plan Mode／目标模式（管理什么、期望什么）**：监测对象、目标、周期、排除范围、指标与成功定义。例如“只在快递到件时通知，而不是看到每条物流通知都提醒”。它对应场景与目标合同。
2. **Strategy Graph／业务操作图（用什么步骤达到目标）**：获取→筛选→抽取→校验→分析→比较→预测→总结→跟进→生成草稿→准备动作→验证。每个节点给出输入事实、确定性计算或有界 AI 工具、输出结构、依赖与失败分支；支持 DAG/条件分支，不允许 AI 自发创建任意外部写操作。
3. **Execution Policy／权限及自动化边界（被允许做什么）**：只读/建议；内部自动整理；需要每次外部动作确认；对明确白名单、有效期、金额/目标限制内允许的低风险预授权动作。Risk/Policy 取**更严格**边界，不能因为用户写“全自动”就降低执行限制。

历史 8 种 `STATE_GUARD、EXPIRY_GUARD、ANOMALY_DETECTION、SILENT_FOLLOW_UP、PERIODIC_SUMMARY、PREDICTIVE_PREPARE、ASSISTED_ACTION、AUTOMATED_ACTION` 作为**兼容/运行时 Profile**保留。向用户优先显示“分析、总结、跟进、预测、准备、提醒、执行”等具体业务操作及其输出；一条计划可按 Contract 组合多个图节点，但编译器会选择/关联版本化 Strategy Profile，旧 PlanVersion 永远维持旧语义。

### 5.2 决策执行层（此前讨论的语义判断 Agent）

原先我们讨论过引入类似独立 AI 判断执行层的想法。实际实现应是**有界语义决策助手 + 确定性决策核心**，而不是让大模型直接点击和操作。建议复用 `AgentContextCompiler/AgentPlanner`：

- **感知相关性**：判定通知/页面段落是否与已授权 `FactDemand` 有关，营销消息/非目标订单默认拒绝进入候选事实；若模型不确定，保留人工确认或低风险候选。
- **事实解释**：AI 可对复杂文本提出结构化抽取候选，并标明依据/字段位置；事实成立只能由 Validator + Evidence/Truth Policy 做出权威判断。
- **策略建议**：AI 基于最新事实提出 `DecisionProposal`，包含选中的业务动作、预期结果、所需能力、风险提示和缺口；编译器检验节点与场景允许范围，现有 Strategy Runtime/Condition AST 决定是否真正触发。
- **执行建议**：AI 只能推荐绑定过的 `ActionDemand`，不能批准自己，也不能持有原始密码。业务目标不明确时先询问用户，无法兑现时给出可行的降级方案而非编造已接通渠道。

`DecisionEnvelope` 最少包含 `planVersionId`、`subjectKey`、`truthVersionRefs`、`decisionRuleRevision`、`goalVersion`、`chosenNextStep`、`evidenceRefs`、`reasonCodes`、`expiry`、`riskHints`、`proposedActions`，不存无必要的原始敏感内容。可重放输入能得到相同的**确定性**决策；AI 提案单独记录模型/提示/结果版本与不确定性，不能承诺概率模型重复输出完全一致。

### 5.3 Plan Offer 的真实合同及选择

Offer 不是“守护/预备/自动化”三个抽象按钮。每份 Offer 都应包含：①目标达成条件 ②Facts & 来源 ③预计采集时效 ④策略图与触发阈值 ⑤动作提供者 ⑥真实权限/在线要求 ⑦结果验证路径 ⑧估计流量、电量、Token/三方收费 ⑨缺口与不支持操作 ⑩实际可用时限、回退和审批预览。`OfferBuilder` 只有在至少具备可核验输入和已实现的节点时才生成“可用”方案，条件不足的列成**待授权/待接入/人工辅助**。`OfferRanker` 仅对通过硬约束的备选技术方案做解释型排序，先淘汰不具备能力或违反隐私/费用上限的方案，再按用户明确权重排列；不让模型虚构百分比成功率。

**用户选择 Offer 时**持久化其身份与内容哈希，进入现有 Plan Draft/Version；若许可证/权限/Provider/Source 后续变化，只能给出新 Offer 和版本迁移提议，不能改变用户曾同意的风险范围。

---

## 6. 有效数据获取：按事实需求采集，而不是“抓得到什么就用什么”

### 6.1 将 Fact Demand 设为获取层入口

每条计划的每个运行对象生成最小 `FactDemand`：具体 `factKey`、`subjectKey`、可接受时效、精度/币种/单位、可信来源类型、是否允许敏感字段离机、冲突策略、使用目的、最晚有效期。仅针对未满足或到期 Demand 调度获取；多个计划若有**相同用户/资源/目的与权限**可安全复用已验证 Truth，跨用户、不同敏感目的绝不缓存互串。

**请求例：**`shipment.current_status`（指定订单/运单、用户本人、最近 10 分钟、需要有事件时间）、`finance.monthly_total`（精确账目来源和月份、去重、金额单位、账单是否完整）。如果数据无法获得，保留 `NEEDS_SOURCE/NEEDS_PERMISSION/STALE/CONFLICT`，不能填入默认值导致误判。

### 6.2 SourceResolver：选择可靠性、隐私和成本都合理的渠道

- S1 **Provider 官方 API / Webhook**：真实账号、资源身份、OAuth Scope 或服务凭据、配额与健康独立检查；只将真实授权可用的 API 标示成官方实时能力。
- S2 **合法系统/设备能力**：Android 系统公开接口、用户自己的设备状态、可信设备签名上报；不代表可访问第三方 App 私有数据。
- S3 **通知/分享/导入**：适合中国市场手机 App 生态，必须绑定真实包名与可信设备、通知渠道/推送时间、Resource/账号关联；重复、旧消息、误命中、营销文案严格过滤。照片/文件导入遵从用户主动选择和本地预处理。
- S4 **受控结构化读取**：仅在适用平台许可、设备权限、用户明确授权、前台目标 App 与选择器 Profile 经过验证时执行；有敏感控件/登录页面则拒绝。不能将 Android Accessibility 当成通用抓取许可。
- S5 **授权截图与本地视觉抽取**：先设备端脱敏，再 OCR/视觉模型输出结构化候选，记录模型、区域、置信度、截图哈希与删除期限；截图本身不是 Truth。
- S6 **用户确认/人工提供**：前五类失败时保持人工协助且说明限制；无需为了“自动化”假装能绕过 App 沙箱。
- S7 **按需任务级 Cloud Browser**：仅用于确实存在网页且合法授权可操作的任务，隔离浏览器、域名/动作白名单、短期会话和凭据代理；网页与手机 App 的数据/能力严格分别标记。

**Source 评分**先过硬规则（真实身份、权限、可用、freshness、schema 与场景适用）；再对满足要求的来源依据可靠性、时延、隐私泄露面、流量/电量、API 配额及费用选择最少采集组合。不得简单写“API 一定比设备更新更快”；每条来源都有**实际实测与场景要求**。付费云平台不是默认来源，模型不能凭经验虚构中国平台公开 API。

### 6.3 CaptureOrchestrator：低成本持续获取

整合当前 Provider/Android 的事件触发（Webhook、Notification、Share）、到期轮询（仅对允许的只读 API）、设备唤醒、用户主动刷新；按需设置 TTL、退避、变化检测、API 预算、网络条件、失败熔断和采集次数上限。电池与网络情况由设备上报，云端只派发**合法的可执行 DeviceTask**；后台离线或受限时显示“下次合适时检查”，不宣称实时。

从 S3/S4/S5 来的大量输入首先进行**Semantic Relevance Gate**：只保留与用户明确订阅的场景/对象有关的字段、判定通知模板的有效更新、丢弃促销/无关账号/重复页面，抽取前尽可能执行本地分类脱敏。相关性模型可以提出 `relevant/irrelevant/uncertain`，`uncertain` 且风险高时必须人工核对。网页内容与第三方工具输出始终是**不可信数据，不是系统指令**，要预防提示词注入。

### 6.4 Evidence → Candidate → Truth 的精度与冲突策略

`Observation` 要包含来源标识、device/provider/connection、采集与事件时间、资源身份、解析器 revision、证据哈希；`Candidate` 绑定字段值、校验与 dedupe key、模型/规则版本；`TruthVersion` 仍由现有权威模块确认。增加可解释来源冲突策略：字段主体必须一致、晚到历史事件不可覆盖已确认新状态、多源金额按币种和账单周期核对，来源相互矛盾时标记冲突和“待核实”，不交给大模型猜测哪个是真的。修正过期 Truth 走新版本，不覆盖不可变历史。

### 6.5 信息获取的可度量质量指标

按 `user+scenario+factKey+sourceMode` 可脱敏聚合：`Fact Demand 满足率`、`有效事实/采集事件比例`、`重复/无关通知丢弃率`、`过期事实比例`、`身份错配拦截`、`数据冲突率与人工确认成本`、`首次可用事实时间`、`电量/数据流量/API/模型费用`。目标优先改善**真实有效事实**，不是尽可能获取最多数据。

---

## 7. 有效执行：从“有一条动作”进化为“实际可做、做对、核实、不会重复”

### 7.1 Action Demand 与 ActionResolver

每个动作显式描述 `actionKey/effectClass/targetSubject/preconditions/expectedState/verificationContract/authorization/risk/expiry`。ActionResolver 对**具体用户与当前设备**检查 API/Intent/Web/Device/人工渠道的真实写能力、版本、权限、健康、目标是否匹配、用户临时授权及成本，再返回经过证据支持的可选路线。**SourceResolver 负责会不会“知道”，ActionResolver 负责能不能“做到”；读取成功不能替代动作权限。**

渠道优先级为：真实官方 API（已授权资源）→ 已公布系统 Intent/Deep Link（只完成其实际开放动作）→ 受控 Cloud Browser 网页步骤（允许使用时）→ 经过审核的目标 App 原生设备任务（仅可证明的有限动作）→ 明确用户辅助/手动交接。视觉模型和结构化读取只用于允许的感知辅助，不因为“看到了按钮”就获权点击。Shizuku/高权限桥接等非标准机制不能作为普通用户默认获取/执行路径；若未来研究，必须单列分发、兼容、安全和合规评估，不替代官方权限。

### 7.2 有界决策与执行配方（ActionRecipe V2）

复用已有 ActionRecipe/Strategy/Capability Resolver；每个 Recipe 定义：进入条件、真实设备或 Provider 证据、目标身份锁定、操作步骤（schema 校验）、副作用级别、前置回读、审批快照、超时及撤权检查、幂等或外部业务查重、提交后回读、未知结果对账、清理/回退规则。Recipe 不是录屏脚本库，亦不是 AI 任意生成并立即执行的脚本。

例如“内容一稿多发”：可以自动生成平台适配文案/封面草稿；没有平台允许的 API/真实授权时仅输出投稿包或引导用户打开原生发布界面。真实发布前必须确认账号、内容、版权及频次；每个平台拥有独立的 `ActionProvider+VerificationPolicy`，某平台失败不可导致已成功的平台重复发布。

### 7.3 事件驱动的持久执行

继续增强现有 BullMQ + MySQL Execution/Outbox：事务写入授权快照、外部意图和唯一副作用 key，再由 worker **一次可控投递**；worker crash、长任务暂停、设备离线、网断后从数据库证据恢复而不是重新发送外部写请求。DeviceTask 支持带签名的 `claim/lease/heartbeat/attempt/result evidence`，任务时效、应用前台状态、设备能力签名 revision 和安全撤权 fencing token。任何外部写请求已发出但返回未知时必须进入 `OUTCOME_UNKNOWN` 与只读对账，**没有可证明的业务幂等时绝不自动再次提交**。

### 7.4 17 步第 17 步的动态改道

Provider 失效、目标 App 升级、手机离线、凭据撤销、事实过期时，触发 `AvailabilityRecompute`。保持当前运行事实与已发生副作用记录不变，优先找等价的**已授权**替代只读来源或执行渠道；只要影响用户风险/数据出站/金额/目标/执行方式边界，就生成一个新的 Offer 并等待用户同意新 PlanVersion。无法改道时暂停相关支路并给出人工步骤，不标失败为成功，也不波及其他无关计划。

### 7.5 真实世界业务结果闭环

执行反馈至少区分 `PREPARED/DISPATCHED/EXECUTING/VERIFYING/SUCCEEDED/FAILED/OUTCOME_UNKNOWN/WAITING_USER/WAITING_PERMISSION` 的合适子集。`DISPATCHED` 只是任务交接，不等于对方接收；截图显示“提交成功”也不能单凭 OCR 认定真实订单已成立。验证应优先取官方业务单号/业务回读；在合法范围内使用独立来源交叉验证，再将新结果引入新的 Observation→Candidate→Truth，驱动后续计划并沉淀 Record/Audit。

---

## 8. AI/MCP/Skills：真正服务于 17 步，而不是独立“万能 Agent”

### 8.1 统一 AI 边界及模型能力

现有 `AgentPlanner` 输出类型以 `ANSWER / PLAN_DRAFT / CLARIFICATION_REQUIRED` 为主，保留“只提议不授权”的规则。将 `AGENT_MODEL` 从当前 Fixture 装配升级为**配置可替换的正式模型适配器**，支持能力协商、严格 JSON/Schema、超时、工具选择安全列表、最大上下文、按用户/计划预算、模型失败确定性兜底与模型供应商退出方案。不能仅因代码中有 Model Adapter 就在产品上标示“具备稳定 AI 自动规划”。

按任务分配模型，避免让昂贵模型处理每条通知：

| 任务 | 优先方法 | 必要时模型 | 硬边界 |
|---|---|---|---|
| 通知模板去噪、关键字段提取 | Android 本地规则/规范化 | 小型本地分类器 | 身份匹配失败即不进入 Candidate |
| 文件/网页复杂抽取 | Schema Parser + 证据定位 | 小/中模型抽取 | 输出候选、保留原始依据哈希，不能直接写 Truth |
| 目标理解、方案生成 | 规则+Scenario Contract+已有模板 | 强推理模型 | 有界 PlanOffer Proposal，不得执行或授权 |
| 跨计划分析总结 | 聚合已验证事实 | 可替换总结模型 | 不得补造金额、账户或日期 |
| 图像识别后备 | 端上预处理+确定性识别 | 受控多模态模型 | 敏感截图需额外离机授权，结果仅 Candidate |
| 动作路线选择 | ActionResolver 硬规则 | 模型提供解释文本 | 真实动作 Provider、Policy 和审批权威在服务端 |

长期记忆只记录用户明确同意的偏好、已验证的资源关系与计划状态；不得将敏感截图、银行凭据、第三方网页恶意文本原样放入长期向量库。检索增强仅用于模板/服务文档、用户授权资料与事实证据检索；RAG 输出永远不比来源 Truth 更可信。对模型输出、MCP tool 描述、第三方网页设置信任区隔、权限 taint 标签、测试集回归和提示词注入阻断。

### 8.2 MCP / Agent Skill 的具体落点

使用已有 `mcp-client`, `mcp-action-adapter`, `lazy-armor-mcp-tools`, `portable-skills`，增加 Tool Capability Registry 的 `effectClass/authorizationScopes/inputSchemaHash/outputEvidence/availability/realAccountAcceptance/providerTTL`。**只读 MCP**在用户授权范围内经审计映射为 SourceObservation，再由 RealityPipeline 验证；**有外部副作用的 MCP**只提出绑定好的 ActionIntent，由同一 Risk/Approval/Execution 链执行。技能按用户当前 Domain/Scenario 逐级披露以减少 Token 与污染上下文；第三方 Skill 不能修改系统安全政策、不能绕过 Schema Validator，不以 Skill 个数衡量可用场景数。

支持适用时的异步第三方任务句柄（例如视频生成），将句柄作为现有 Execution 的外部子任务证据，而不把 MCP Tasks 或外部 Agent 当成本系统的第二个权威 Workflow 引擎。新增自定义 Connector/MCP 之前必须给出真实使用场景、权限和输出验证方式，否则不列为可用来源。

### 8.3 计划解释和人工接管

AI 的消费者输出应分别显示：我从哪条已授权事实得出结论、哪些数据仍然缺失、备选方案的真实限制、我现在能做/不能做什么、需要用户执行哪一步。每个长任务可暂停并交给用户继续；用户手动完成后必须通过实际回执或明确的“用户报告未核验”证据推进，不将“用户点击我已完成”直接冒充官方业务验证。

---

## 9. 前端 VNext：简单外观容纳完整 160 场景和 17 步

### 9.1 最终固定五入口、统一底部与首页布局

```text
[头像]  [首页]  [计划]  [私密]  [商城]       ← 单行横向胶囊，可滚动

最近                                      查看全部 >
         [侧卡] [中央主卡] [侧卡]          ← 轻 3D 叠加 Coverflow

计划                                       ← 标题纯文本，不放 ···/＋
[我的生活] [我的财物] [我的事务] [我的工作]  ← 四个固定空间，不放＋

▾ 家庭                               ··· ＋
    家庭补给                          ··· ＋
    成员事项                          ··· ＋
    家庭日程                          ··· ＋
▸ 健康                               ··· ＋
▸ 出行                               ··· ＋

[ 全局搜索 ]  [ 万事问 AI ]  [ 快捷操作 ]  ← 固定底部三控件，无 Tab Bar
```

- 顶部头像管理个人账户、连接、设备、会员、登录安全、通知及设置；不展示私人保险库内容。点击当前产品胶囊只切换一级工作区，其他页面用轻量返回/标题展示，不用额外一条 App Rail。
- **最近**替代“正在进行”：展示最近访问、最近真实进展、用户置顶的 3～5 张卡，中央主卡完整、两侧轻透视外露；不可把无验证来源的“成功”画为绿色。无计划时是干净空态，不伪造三张演示卡。尊重系统减少动态效果和低端机性能，无障碍下退化为顺序列表。
- **首页计划树**：四大空间固定展示入口；当前空间显示归属领域，领域按需展开场景；场景可再展开其已有计划，避免与顶部计划中心功能完全重复。`领域···`=简介/排序/收藏等，`领域＋`=先选本领域场景再创建；`场景···`=能力/说明/已有计划，`场景＋`=固定场景上下文创建。创建入口复用统一 Builder，不分叉建两个流程。
- **计划中心**：不是另一个 160 场景目录；一页极简已安装计划列表 + 状态筛选（全部/运行/等待/暂停/草稿/结束）+ **记录时间线作为该中心内页**。点击计划下钻进度、17 步消费者投影（默认简化）和必要的 15 步执行证据。首页最近卡/场景计划直达同一详情 URL，不先重复走计划中心。
- **私密**：独立锁态；密码、个人资料、私密文件、用户主动导入的应用数据、授权记录采用极简列表，默认不通过全局搜索、AI 搜索建议或商城露出敏感标题。
- **商城**：保留必要商品图片但沿用同一设计系统。计划生成的是采购意向/对比清单，真实商品接入前显示“待接入”，不展示虚假价格。
- **底部左**全局检索（私密另行解锁），**中**AI（当前空间上下文+权限提醒），**右**基于页面的快捷操作（首页开始创建/导入、计划中快速操作、私密新增密钥或文件、商城新增需求）。不能让顶部/场景/底部三个 `＋` 都执行完全相同的模糊动作。
- 此前讨论过的顶部/右下角页面堆叠是**独立可选的页面多任务状态**，只能在原导航延伸区域内横向展开；右下角向左展开但不得与底部快捷操作按钮重叠。页面堆叠不是后台 Plan 执行队列，关闭页面不暂停真实计划。

### 9.2 160 场景前端不能用普通长数组硬渲染

RN 以可复用虚拟化列表、领域分组按需展开、索引搜索与最近上下文缓存管理完整目录；搜索索引仅包含共享目录和**当前用户允许的**计划数据。单个场景详情调用已有 Consumer Projection v1（后续可增量 v2），展示“产品能力是否已验证 + 当前用户为什么可用/不可用 + 明确下一步”，不要从静态 `scenarioKey`、Android 已安装 App 或模型回复自行得出 READY。新增目录先过运行时 Schema 校验再进入消费者。

### 9.3 17 步的信息分层

普通创建页只展示：目标→实际来源→方案对比→授权→创建。已经安装的计划先展示“当前状态、最近事实、下一步、为什么”，愿意看细节再下钻到 17 步生命周期、一次 Execution 的 15 步及证据审计。不要把每一位用户的首页变成 17 步工程流程图。中断创建时可恢复 Draft，切换回首页保留选择的空间和领域展开状态。

---

## 10. 「私密」：真正本地优先的个人凭据与私人资料控制中心

### 10.1 产品范围和严格隔离

顶部名称固定为**私密**，包含账号密码与未来可选 Passkey、身份证/驾驶证等私人资料、私密文件/照片、主动导入的第三方 App 数据、软件授权/恢复码、访问记录及可撤销授权。**“应用数据”并不意味着能读取任意已安装 App 的沙箱**，仅支持平台允许的分享、导出、开放 API 和用户显式选择。懒人装甲自身登录仍可采用已确定的手机/邮箱验证方式；私密独立解锁，不强制用户拿私密主密码作为 App 登录密码。

### 10.2 本地密码学与授权代理

Android 原生 `LocalVault` 采用本地独立加密存储：文件与结构化记录分别加密，随机数据密钥、Android Keystore 硬件保护（设备支持时）、系统生物识别便捷解锁、独立恢复密钥/主口令、屏幕自动重锁。选择可信加密实现与成熟库；禁止自研加密算法或将整座保险库放进普通 AsyncStorage、React Query 持久化缓存、错误报告或日志。锁定期间连敏感条目名称/缩略图/搜索结果也最小化隐藏；密钥丢失且无恢复材料时如实提示无法恢复。

建立手机端 `VaultBroker`，通过 `VaultGrant` 描述具体条目、使用目的、计划/动作、目标设备/网站、允许出站的数据字段、时效、解锁要求及撤销；AI、商城和云端默认只获得 `credentialAvailable` 或用途受限的非 Secret 句柄，不能列举整座私密库。**本机密码只用于本机受控操作**；云端需要 OAuth 时由服务端现有 CredentialProvider 在另外一次明确授权下保存独立 Token，不能偷偷上传原始密码。必要文件离机处理必须弹出独立用途同意，且可选择始终只在手机上运行并接受离线限制。

自动填充优先兼容用户现有密码管理器，再实现自己的 Android Autofill/Credential Provider；需要防止 App/网站假域名、钓鱼界面及 Accessibility 泄露。备份由用户主动开启，客户端加密、可恢复性实测、导出需重新验证；云端备份只保存密文与必要的恢复元数据。安全评审以 OWASP MASVS/MASTG 的存储、加密、认证、网络、平台、隐私等检查点为基线。

### 10.3 私密与真实计划协作

例如“每月账目整理”：由用户手动选择导入账单或授权合法官方接口，若选择私密文件则先向 `VaultBroker` 请求该指定文件的最小授权。提取的账目事实按隐私分类进入受控的 RealityPipeline；用户可选择本地统计，缺乏明确授权时后台不得把身份证、原始密码或整批私密照片送入云模型。隐私授权撤销必须同时阻止后续采集、新的 Action 以及缓存重用，既有审计只保留合规且脱敏的必要证据。

---

## 11. 「商城」：由计划发现需求，到商品与服务真实履约

将仓库现有 `commerce.tsx` 作为用户页面基础，后端**需要真正补齐的不是另一个 Plan Engine，而是领域交易系统**：商家/履约主体、商品/SPU/SKU、兼容规格、真实报价与有效期、库存/运费或服务范围、采购意向、用户确认单、订单、支付渠道回执、物流/安装/售后记录、争议及退款。每项业务数据要有自己的所有权边界与审计，而不能直接把商品业务表当 Truth Store 或把 Truth 当最新零售报价。

流程固定为：某场景 FactDemand 表明需求（例如净水器滤芯接近更换期）→ Plan 生成**可编辑采购意向**→ 授权查询可核实商品/规格/商家→ 价格与兼容性检查→ 用户确认商品数量、最终金额、地址和服务条款→ Risk/Approval→被允许的订单接口→官方订单 ID 回读→物流/售后进入 Observation→Truth→后续计划。无合法第三方订单接口时只允许打开相应平台或生成购物清单，不用 UI 自动点击规避平台限制。支付首阶段始终由用户在正规渠道确认；不保存银行卡安全码，不允许结果未知时重复下单/付款。商家只获取履约所需最少字段，不得访问用户全部计划和私密库。

商务上可逐步增加自营、本地生活服务和第三方供应商，但 **“160 场景覆盖”不等于“160 类商品必须自营”**，场景目录独立于商品目录。商家与平台数据接入必须遵守当地法律、分发条款、支付/消费者保护要求。

---

## 12. 后端与数据库增量设计：按现有仓库落点，不虚构第二套系统

| 现有目录/模块 | 增量能力 | 不允许的错误做法 |
|---|---|---|
| `packages/plan-schema/src/product-model.ts`、`scenario-plan-compiler.ts` | 新增经评审的 64 场景版本、Scenario Contract V2、三维策略 UI→旧 Profile 映射、17 步外层消费者 Schema | 覆盖旧 96 `key/hash` 或将 17 步直接替换旧 15 步数组 |
| `packages/plan-schema/src/{mobile,reality-pipeline,strategy-runtime,action-recipe}.ts` | Versioned `FactDemand/Offer/Decision/ActionDemand/Verification` DTO 与运行时校验；RN-safe 导出 | API/前端自行定义不同的状态字符串 |
| `apps/api/src/runtime-catalog/*` 与 `scenario-coverage-ledger/*` | 160 场景治理 Readiness、Source/Action 双能力矩阵、真实证据 TTL、域映射兼容 | 靠目录标志推断用户 READY |
| `apps/api/src/reality-pipeline/*`、`truth-store/*` | Demand→观察采集、相关性过滤、主体匹配、跨源冲突与 Versioned Truth 投影 | 模型/通知/截图直接写真实完成状态 |
| `apps/api/src/capability-resolver/*`、`provider-capabilities/*` | 增量 SourceResolver/ActionResolver 解析函数、能力成本与匹配证据 | 再建并行 Capability Registry 或以 S3 通知冒充执行权限 |
| `apps/api/src/ai-adapter/*`、`portable-skills/*`、`mcp/*` | 正式模型适配器、有界 Planner、PlanOffer Builder/解释型 Ranker、Skill 按需路由、注入防护 | 大模型自行批准/调用外部副作用，fixture 冒充在线模型 |
| `apps/api/src/strategy-runtime/*` | 三维策略编译、Versioned DecisionEnvelope、授权改道及依赖变更监听 | AI 替换现有 Condition/Risk 或后台修改已固定的 PlanVersion |
| `apps/api/src/device-tasks/*`、`trusted-devices/*`、`reconciliation/*` | lease/fencing、设备级动作证据、多设备抢占、unknown 对账与后台撤权 | 网络断开盲目重发写动作 |
| `apps/mobile/android` + config plugin | Notification/Share 真实接入、按需结构化读取、安全本地保险库 Broker、合法后台调度 | 将原生代码只改进 generated Android 目录而未同步 config plugin；读取其他 App 私有沙箱 |
| `apps/mobile/src/design`、`app/(tabs)`、`app/plans` | 原创极简 Shell、3D Recent、160 场景树、统一 Plan Builder、17 步渐进式解释与计划记录内页 | 用四个新空间重写核心 domainKey、静态填充假数据 |
| `apps/api/src/commerce`（先检查真实现有结构） | 采购意向与交易领域服务、订单/报价/履约 Provider Adapter；前端复用既有 `commerce.tsx` | 单凭计划文本当真实 SKU/报价；支付绕过审批 |

**数据库变更原则**：先审计 Drizzle schema 和已有 `truthFactDependencies`、`strategyRuntimeDecisions`、PlanVersion、SourceObservation、ActionRecipe 和审计表。能做投影/新增 revision 的不用造表；确定确需持久化才新增 migration。优先补充**有效期明确的选择凭证/Offer 快照**和**跨场景关系**等尚无等价存储的对象，避免 `FactDemand` 与既有 truth dependency 双轨，避免 `Decision` 与现有 StrategyDecision 双轨。迁移 append-only，禁 destructive/historical DML；在 MySQL 8.4 上反复 migration forward/rollback rehearsal（若当前框架不支持安全回滚，用备份与可重放验证代替危险反向 DDL）。

### 12.1 推荐 API/契约方向（新增前先复用既有路由）

- `GET /api/scenarios/:scenarioKey`、现有 readiness 与 runtime-evidence：追加 `contractVersion` 的最少消费者投影，不破坏既有字段。
- `GET /api/strategy-runtime/bindings?scenarioKey=...`：复用已有每场景用户计划关系。
- 目标新增 `POST /api/planning/offers`：**仅生成建议**并返回真实性证明/缺口，不创建 Active Plan；与现有 Planner/Compiler 共用实现。
- 目标新增 `POST /api/planning/offers/:id/choose`：绑定确认版本与可兑现约束，经现有 `/plans` Draft/Version 路径执行，不直接下发外部动作。
- 目标新增只读 `GET /api/runtime/fact-demands?planId=...` / `GET /api/runtime/action-options?planId=...`：由已有依赖表及 Capability Resolver 派生，不暴露凭据或未获授权的其他资源。
- 目标新增 `GET /api/plans/:id/lifecycle-projection`：17 步外层消费者状态，实际来源仍为 Plan/Truth/Execution/Audit。
- 目标新增 `GET /api/home/recent`：最近卡片所需的已授权最小摘要、时间戳与状态，不让 Mobile 根据任意通知猜测状态。
- 私密：`VaultBroker` 核心是**本机 IPC/Bridge** 而不是“上传本地密码的 REST API”；服务端只记录不含 Secret 的用途限定授权元数据（在用户选择跨设备功能并明确授权时）。
- 商城：在现有业务模块审计后增量设计采购意向/真实报价/订单/验证接口，不虚构已存在的路由或部署资质。

这些是目标合同路径，尚非当前 GitHub 已实现的接口，编码前必须做接口名称/数据库复用检查。所有请求包含当前用户身份/授权、版本和限额；新增字段采用 `@lazy-armor/plan-schema` 类型与运行时验证，配套生产/沙箱能力区分。

### 12.2 17 步生命周期投影示例（目标草案）

```json
{
  "contractVersion": 1,
  "planId": "<owned-plan-id>",
  "planVersionId": "<immutable-version-id>",
  "scenarioKey": "daily_life.delivery",
  "goal": "只在指定包裹到件或异常时提醒",
  "requirements": {
    "facts": ["shipment.current_status", "shipment.last_event_at"],
    "actions": ["notify_user"],
    "verification": ["notification_delivery_receipt"]
  },
  "readiness": {
    "product": "IMPLEMENTED",
    "user": "NEEDS_PERMISSION",
    "reason": "手机尚未授予指定通知来源读取权限",
    "nextAction": "打开手机权限设置"
  },
  "lifecycle": {
    "currentStep": 6,
    "nextEligibleStep": 7,
    "evidenceRefs": [],
    "lastUpdatedAt": "<server-timestamp>"
  }
}
```

仅示意字段结构；真实状态必须由用户归属的权威记录计算。`product=IMPLEMENTED` 还需满足具体 Source/Action Contract，而非目录中有代码即为实现。

---

## 13. 中国手机生态与云边协同：必须实用、合法、可验收

### 13.1 三种执行环境（不是三套引擎）

- **云端：**现有 NestJS/worker 管官方 API、Webhook、计划编译、确定性条件、合法长任务以及审计；Cloud Browser 是独立短生命周期任务适配器，按实际需求启用，不要求所有用户长驻云 VM。
- **手机端 Android：**Notification/Share/Intent/本地导入、按需 OCR/预处理、TrustedDevice/DeviceTask、本地私密、用户参与确认。符合 Android 后台工作 API 的调度；不因用户关闭 App 就承诺任意 UI 会在后台继续点击。
- **其他 Edge：**PC、家庭网关、车辆等作为未来的能力提供者/设备类型，沿用证书化设备身份、单一 Resource/Fact/Action 合同，不因为加入 PC 就另建计划引擎。

`CloudDispatcher` 只分发逻辑动作，设备端收到时仍需做授权、前台包名与 capability revision、租约签名、风险 fencing 的二次检查。来源数据由设备脱敏后发出，网络断线有界队列不应无限堆积敏感通知，重新联网要剔除过期事实和失效凭据。手机与网页两种渠道可组合，但不能假装云端模拟的是用户真机 App 或同时拥有用户本机登录状态。

### 13.2 中国首发 Provider 的真实验收策略

建立官方能力调查台账：平台、API 文档版本、开发者资格、用途协议、OAuth/开放权限、可获取事实、允许操作、第三方成本、实名认证/合规约束、当前真实性等级。优先发展不依赖非法自动化的五条真实消费者闭环：账目整理、快递静默管家、设备耗材、家庭补给、每日重要事项。没有官方 API 的国内平台，先做其实际允许的通知、用户分享、人工导入和跳转能力，不承诺任意聊天/支付/购物 App 的全功能自动化。

Web 提供可用 API 并不说明中国 App 内同等能力存在；必须单独验证实际 App 的数据授权、通知字段、国产系统后台权限和用户真实操作路径。不同品牌设备的通知/耗电/后台表现作为测试矩阵，不能用单一测试机结果声明全部国产手机可用。

### 13.3 多设备、推送与可用性

可信设备必须独立密钥与撤销；Push 只携带不含业务正文的 opaque task hint，不能作为 Truth 依据。在线/最近 heartbeat/已安装/已授权/已验证动作按维度区分；任务创建成功不等于设备已接受。引入设备能力缓存 TTL、网络/耗电策略、短时 lease 续约及断线对账，禁止多个设备对同一外部副作用同时下发未 fence 的写动作。

---

## 14. 先进工程措施：重点是可用性和安全，不是叠技术名词

1. **Contract-first + Versioned Registry：**所有新的 Scenario/Fact/Action/Offer/Decision 的 Schema 先进入共享 `plan-schema`；版本、哈希、弃用与兼容迁移有单元测试，前端严格运行时校验。
2. **Evidence-first + Privacy by Design：**每个 UI 声称的进度必须能追到已授权证据；没有证据时显示未核实/过期/仅人工，而不是造测试数据。
3. **Durable Execution + Idempotency：**优先修复现有 MySQL 并发/Outbox/Lease/Verification，而非马上另装 Temporal；到真实长任务规模显著增加、可量化运维收益后再评估迁移，并给出共存/退出方案。
4. **Source/Action 语义隔离：**读取能力与执行能力双独立证明，不将“AI 能理解页面”当“有权限操作账号”。
5. **政策即代码（Policy-as-Code 增量）：**以当前 Risk/Approval 执行清晰的用途、数据最小化、金额/对象限制、设备、时限、撤销和外部操作阈值；禁止 Agent 降低服务器设定。
6. **多租户最小权限：**所有 User/Household/Provider/Resource/Plan/Truth/Evidence 的读取与写入都在后端检查归属及委托，不能信任客户端传回的 userId。家庭关系 ≠ 数据访问授权。
7. **可观测与成本治理：**用现有 Trace/Correlation ID 接上 OpenTelemetry 语义，统一串联 Source→Observation→Truth→Decision→Execution→Verification，日志禁止原始 Secret/PIN/私密文件；统计真实结果成本/每条有效事实成本而非纯 QPS。
8. **供应链与发布治理：**锁版本、自动依赖审查/SBOM、CI 权限最小化、受保护 `main`、带 provenance 的 Android Artifact、密钥外部管理、正式部署审批，发布时按用户/Provider/效果级灰度启用能力。
9. **故障隔离与退化：**官方 Provider 429、Web UI 变化、国产手机休眠、模型故障、权限撤销均只影响相关 Fact/Action 支路，其他计划继续服务；可切换人工接管并真实说明限制。
10. **安全审计与威胁建模：**针对 Android 本地保险库/自动填充、网页提示词注入、MCP 投毒、设备假冒、越权审批、订单重复写入建立独立高风险场景矩阵。参照 OWASP MASVS/MASTG，不以“用了 AES-256”代替全面审计。
11. **真实体验闭环：**每个已发布场景记录“用户从提出目标到第一次真实收益的路径长度”，持续删除无价值二次点击和技术术语；上线指标是省下的检查次数、无效消息比例、用户需要确认的次数与有效任务完成率。

---

## 15. 测试与验收：160 目录数量、17 步可追溯、有效事实与真实动作分开判定

| 测试组 | 具体测试 | 验收结果与严禁事项 |
|---|---|---|
| 目录兼容 | 逐 key 检查旧 96 的 revision/hash，新增 64 无重名；显示四空间下19域与总数160 | 不因已有 `@2` 场景修订使版本行数误认成新 canonical 场景数；旧 96 历史计划无需迁移仍可运行 |
| 场景合同 | 新增场景 Fact/Action/Verification 完整性，0-N 模板及去重评审 | 160 是目录目标，不是 160 均具有 PRODUCTION_REAL；无来源/动作时真实显示能力缺口 |
| 17 步 | 从目标设定、能力发现、Offers、选择、PlanVersion、Truth、Decision、Execution 到持续可用性重算的全链路状态与跳转 | 任一步失败或缺权限都可以解释/停留/恢复，绝不跳过必需内核权限检查 |
| 来源有效性 | 同包裹重复/旧通知/多账号错配/营销消息/页面结构变化/金额单位混乱/权限到期/两源冲突 | 无关事件被丢弃，错配和旧值不能生成当前 Truth，冲突显示待核实；离线重连不发布过期新事实 |
| Plan Offer | 无渠道、渠道已过期、用户无权限、能读不能写、费用超预算、低可信来源 | 不提供“可自动执行”的伪方案；解释路线的真实前提并给人工降级 |
| 策略与决策 | 分析/总结/静默跟进/预测/条件动作组合；AI 提案字段超限/恶意工具提示/错误身份 | 图节点只使用注册 Action/Truth；相同确定性输入有可重复决策；模型不能绕过 Policy |
| 外部副作用 | 同订单两设备竞争、网络超时、Provider 返回 429/5xx、Worker 重启、设备 lease 过期、结果回执丢失 | 没有证明可重试时保持 `OUTCOME_UNKNOWN`，只读对账，禁止盲目重复提交/付款/发帖 |
| Android 真实验收 | 权限授予/撤销、系统后台限制、Notification→Truth、Share→Truth、AppReadSession、DeviceTask、前台包名校验 | 分别保存经过脱敏的真机证据；前台成功不能代表后台全机型可用 |
| 私密 | 锁屏重锁、错误生物识别、数据字段最小授权、离机边界、加密备份恢复、日志/截图/跨账号 | 未解锁时全局搜索/模型/商城不可枚举私密内容；不具有主密码或恢复材料时不得伪称可恢复 |
| 商城 | 报价过期、商品型号不符、服务不可达、下单后连接断开、退款/售后异步更新 | 对账确认前不宣称下单成功，明确禁止自动重付款；商家不能访问无关计划和私密资料 |
| UI 与性能 | 360dp 小屏、横向顶部溢出、Coverflow 减少动态效果、160 场景搜索/树折叠、键盘遮挡、系统返回和可访问性 | 一屏不过度堆叠，状态与服务端投影一致，点击区域可访问，不从图片/fixture 推导真实运行 |
| 发布与运维 | 与候选提交**同 SHA** 的 Fast/Full/Android、MySQL 8.4 migration/backup-restore、Provider 真账号、真机、压力/故障注入 | 按单项说明“代码通过/沙箱通过/真实账号未验证”，未经全部相关生产门禁的功能默认关闭 |

### 15.1 五条消费者黄金链（不是抽象单元测试）

**G1 手机账目整理**：用户授权系统通知/账单文件 → 指定账号与周期 → 解析账单去重、币种核验及不完整月份识别 → 形成可信月度事实 → 策略图进行分类/汇总/异常提示 → 生成可审查结果；没有官方总账 API 时不能声称完整读取用户全部支付宝/微信交易。

**G2 快递静默管家**：从用户明确许可的通知、合法 Provider 或分享中拿到资源身份 → 过滤营销/旧通知/重复轨迹 → 经过候选与可信事实版本 → 策略仅在指定到件/异常条件变化时产生通知 → 记录实际推送/回执及异常等待；不要用一次“收到通知”冒充快递业务终态。

**G3 设备耗材**：基于用户输入的具体设备/型号和有来源的使用数据 → 根据耗材阈值/周期及不确定性预测 → 先给用户准备下一步 → 可选商城核验真实 SKU 与报价 → 用户确认购买；没有设备的实时传感数据时展示推算而非“实时读取”。

**G4 家庭补给**：库存/消费事实（用户记录或可用 Provider）→ Demand→补货提案→价格/型号/库存核验→用户编辑清单→明确确认订单（首发阶段不自动真实下单）→后续物流/收货来源更新；供应不足时透明解释，不编造商家库存。

**G5 每日重要事项**：用户授权的日历、邮件、设备通知及已有计划状态 → 语义过滤低价值消息 → 去重合并与时间冲突检测 → 只读摘要+必要行动建议 → 如需创建/改动外部日历，另走 Risk/Approval/ActionResolver/Execution/Verification。

增加 **G6 跨平台内容协作（扩展验收）**：用户内容资产→适配多个平台格式/版权→在已接通平台进行获准发布或生成手动投稿包→分平台读回发布 ID/链接→失败平台独立对账。它用于证明云端/API、手机端与人工交接的 ActionResolver 有效，不作为首发五条的替代品。

### 15.2 关键产品指标（需要按真实 Beta 基线分阶段设阈值）

- **事实有效性：**`已验证且满足时效的 FactDemands / 总到期 FactDemands`，而非原始抓取条数。
- **决策有效性：**决策因果解释完整率、人工驳回原因、重复无效通知比例、条件命中误报/漏报抽样。
- **执行有效性：**`真实验证成功的独立外部操作 / 已启动的符合条件操作`、验证延迟、未知结果等待时间、人工接管完成率、重复副作用事件。
- **真实价值：**用户每周少打开多少次其他 App、减少多少重复核对/填写、从首次创建到首个真实结果的时长，以及计划的持续留存。
- **成本与隐私：**每个有效结果的流量/电量/Token/API 成本、因权限而中止的合法请求、隐私撤销生效率；任何真实敏感资料泄露或未经确认的高风险副作用都是发布阻断，不以平均成功率冲抵。

---

## 16. 连续开发任务与 PR 结构：后端深化优先，不把 UI 当成项目完成

下面的编号用于**下一阶段增量工作线**，不是重新命名、否认或清零仓库现有 R0–R9 成果。普通失败应定位后继续；仅涉及真实资金、非法授权、数据外泄、核心幂等/验证不变量或不可安全迁移的风险才 Hard Stop **相关链路**，不无故暂停其他工作。

### PR-00｜守住现有代码，核对并发与 Android 门禁（并行启动）

- 基于已同步的 `c626e10` 创建受控 Draft PR/后续小分支；检查 27 commits 的完整 diff、敏感文件、Android config plugin/native 双份一致、已发生迁移安全。
- 触发此开发分支**同 SHA**的 Fast Gate/RC Full/Android，分析先前 main 的真实数据库并发全量测试失败及 debug Android 构建失败；不照搬旧报告的成功日志。建立 `main` 所需状态检查、审查流程和独立受保护发布配置。
- DoD：每个失败都有明确可复现原因/修复/回归记录，MySQL 8.4 迁移与备份恢复没有误删现有数据；未获真实 Provider Secret/真机授权的门禁继续标待验而非“通过”。

### PR-01｜160 目录与 Scenario Contract V2（后端与共享 Schema 优先）

- 先提交**96+64 的候选目录文档与去重报告**，不要立即把全部新增场景挂为可用。逐域审查 64 个建议是否只是旧场景的参数/策略变化；仅通过者注册稳定 key/revision，数量不足 160 时补真实非重复需求而不造空目录。
- 为先发布的一小组新增场景写完整 Fact/Action/Verification/Risk/Privacy 合同、RT Schema 与编译器回归；给目标目录增加治理状态/事实源缺口说明。前端空间展示映射按新版四组实现，但内部旧 group 和 PlanVersion 保持兼容。
- DoD：旧 96 全部 key/hash 与依赖计划兼容；新增注册唯一性、目录总数、所需事实去重、版本迁移无历史改写。**通过合同不等于真实动作上线。**

### PR-02｜Fact Demand、SourceResolver 与语义过滤（获取力主线）

- 以现有 TruthDependency、CapabilityResolver、RealityPipeline 为基础生成 demand、选择可用来源、按实际权限/时效/隐私/成本调度；第一期只做已有通知、分享、导入与一两个真实 Provider，不为“所有 160”写 160 个特例。
- 强化身份绑定、重复/历史/营销过滤、多源冲突、TTL、证据和本地脱敏，增量输出用户可理解的缺数据原因；所有模型提取先落 Candidate。
- DoD：G1/G2 在真实设备上可以从有权限的 Source 进入可信 Truth；无关数据不唤醒用户；失效/离线/冲突必须 fail-closed。

### PR-03｜17 步外层生命周期与三维策略（编译和决策主线）

- 定义 17 步版本化消费者/进度合同与“创建/运行/再规划”边界；扩已有 AgentPlanner、Strategy Runtime 形成 Goal/Subject/StrategyGraph/ExecutionPolicy/DecisionEnvelope。
- 将既有八 Profile 作为兼容键并测试 old immutable hash；编译器拒绝无法对应已注册能力的图节点；AI Proposal 与确定性 Decision 独立记录。
- DoD：五个典型需求从 Domain/Scenario 生成并确认 User Plan 后，可以在事实变化时产生可解释的下一步；权限变更只生成 Offer/新版本请求，不静默扩权。

### PR-04｜真实 Plan Offers、ActionResolver 与可验证动作（执行力主线）

- 选择只读/内部整理/需要确认的外部动作三类真实样本，把 `SourceResolver` 和 `ActionResolver` 的输出组合成 1～3 个有真实性等级的 Offers；调用现有 Plan/Compiler/Execution/Outbox/Reconciliation。
- 为合法官网 API、Intent/Deep Link、人工交接以及后续 Browser/DeviceTask 设计统一的 ActionProvider 合同和独立 VerificationPolicy，先从**可验证的低风险动作**做通。
- DoD：没有可执行 Provider 时 Offer 显示仅准备/辅助；写后网断保持未知并对账，不会重复对外发送同一业务动作。

### PR-05｜云边增强、国产数据与浏览器后备（按真实适用性分批）

- 完成 Android 通知、分享、DeviceTask、结构化读取的实机长时间证据、权限撤销与多设备任务 fencing；选择确实可接入的国产官方 Provider。
- 任务级隔离 Cloud Browser 先做合法只读事实采集及受控表单预备；只有通过平台合规、身份保护、真实回读和手动确认的场景才逐项开通受控写动作。
- DoD：G1～G5 使用至少两类独立实源，不用 fixture 掩盖；设备进程死亡/断网/撤权及 Browser 异常均有确定状态和可追溯证据。

### PR-06｜极简全局 Shell 与首页/计划/记录一体化（与后端并行但不得造数据）

- 移除左固定 Rail 的可见结构，建立五顶部胶囊与三底部入口；实现“最近”轻 3D 卡、首页四空间领域/场景树及严谨 `…/＋`，计划中心包含完整执行记录时间线。
- 所有新卡片读现有 API 或经过版本化的新 Consumer Projection，完全不在 UI 猜测真实可用、已授权或已完成。对 160 目录做虚拟化搜索与状态保留；Coverflow 支持减少动画。
- DoD：360dp～大屏兼容、系统手势/键盘无冲突；首页与计划中心不互相重复；旧历史页面深链不失效。

### PR-07｜私密本地基础、安全审查与受控计划协作（独立高敏感门禁）

- 先实现独立锁态、安全储存/密钥恢复/备份、最小元数据访问；再接 Android 合法密码填充与 VaultBroker 授权。敏感文件离机处理必须独立用户同意。
- 将现有 `secure-token-store` 与服务端 `LocalEncryptedCredentialProvider` 视为**不同信任域**，不得互相覆盖。
- DoD：未经解锁无法由 AI、商城、全局搜索读取资料；撤权/账号切换/备份恢复和日志脱敏通过专门安全测试后才开放真实用户数据。

### PR-08｜商城采购需求与交易合法闭环（与私密隔离并行）

- 先打通场景→事实→待购买/服务需求→真实规格与可核验报价→用户编辑清单；其次才增加商家、订单、支付渠道及物流/售后。每个真订单走 existing Risk/Approval、唯一副作用/Verification。
- DoD：G3/G4 获得真实需求与采购清单，未接入真实商家时不得显示假价格；未知订单不重复付款，私密资料不被商家越权读取。

### PR-09｜跨场景关系、Bundle、长期运营与 Beta 放量

- 经证据支持的资源关系复用、跨场景依赖、消费者降噪、用户可撤销个人偏好与成本预算；结合模型/Source/Action 的真实成本数据做质量优化。
- 统一跨模块 OpenTelemetry 关联、服务成本与隐私事件观测；对新的场景按实际来源/动作/回读测试逐项从 CATALOG_ONLY 升级，不追求一口气让 160 个场景全部真实自动化。
- DoD：邀请 Beta 中 G1～G5 的真正重复使用率、错报、未知结果与省时收益可以度量；敏感高风险链路保持独立发布审批，相关证据不过关时持续关闭。

### 16.1 Codex/TRAE 的首轮具体执行要求

先在 `C:\la\lazy-armor` 当前开发分支上完成只读检查和证据表，避免一上来把 UI、160 目录、私密和交易一起改成不可审查的大提交。第一轮重点依次是：

1. `git status -sb` 与当前 SHA、`main` 的差异；仓库 `package.json` / CI / 目录 registry、已注册 revisions、最近失败同 SHA job 证据。不要添加 `.codex-runtime/`、原始截图、`.env` 或用户密钥到提交。
2. 生成 `96→160` 逐场景去重与来源-动作-验证覆盖台账，给出 **64 新增候选的保留/合并/待调查**结论；源码中只有正式批准的新增 Contract 才进入 canonical 目录。
3. 在**现有** `capability-resolver`、`runtime-catalog`、`reality-pipeline`、`strategy-runtime`、`ai-adapter` 中标出可复用函数、实际缺口、最小变更路径；画出 FactDemand 与 ActionDemand 在已有表/接口中的读写归属，任何新表必须证明旧表无法安全复用。
4. 先实现 17 步消费者 Schema/真实 Readiness 和一个闭环 Plan Offer 的确定性集成测试样例；继续 Android notification/share 实机证据与 RC 修复并行推进。
5. 然后才替换最终移动端外壳、引入低成本正式模型适配、扩完整获取与动作方案；每个 PR 依照上述对应 DoD 验收，普通工程失败边修边推进，高风险真实动作不开启。

---

## 17. 典型完整例子：为什么有了 17 步与强后端，160 场景才不空心

### A. 「帮我每月整理微信、支付宝和银行卡消费」

系统从财务场景识别用户目标和**哪些账户、哪个月份**；Scenario Contract 需要各来源账单/周期/币种与重复交易识别。SourceResolver 实际发现官方可用渠道、用户分享的账单或合法的手工导出，给出每份信息的缺口；如果无法读取完整平台账本，明确“不覆盖未导入的账户”，而不是 AI 自行推算总额。Offer A 可为自动整理已授权来源、缺口部分提示导入；Offer B 可为全人工导入与本地分析。用户选定并固定 PlanVersion 后，Demand Scheduler 按月采集、校验、去重及形成 Truth；Decision 选择分类、预算对比与摘要图节点；内部分析生成结果，涉及发送给其他人的报告或编辑外部表格则进入 Risk/Approval/ActionResolver。验证生成的金额可追溯到真实来源，记录不完整标志与人工确认。平台改权限时重新生成 Offer，不自动切到需要额外泄露账单的云服务。

### B. 「我的快递到驿站时再告诉我」

识别运单或可验证订单与允许的通知来源，建立 `shipment.current_status` Demand；通知到达时先按包名/账号/对象/事件时间筛掉无关促销和重复变化。对同一运单只更新版本化候选与 Truth，旧“派送中”不可覆盖新“到件”；`CHANGED + 指定到件状态` 成立时，Decision 提出发提醒（非支付/取件动作）。由 Notification Provider 发送，再验证发出或接收回执，记录提醒已发与业务状态的区别。手机通知授权被撤销时系统切换到用户允许的其他真实来源，若没有则“等待重新授权”，不再误报快递实时跟进。

### C. 「同一短视频准备好，帮我发几个平台」

Scenario Contract 规定目标平台账号、内容版权/敏感风险、合法可执行 Provider、发布时间和逐平台成功证据。Plan Offer 把平台分为真实官方 API 可执行、只能产生投稿包/系统 Intent、尚不支持三个集合。AI 可生成标题、标签、封面与不同平台文案，但不能以“写完内容”冒充“成功发布”。发布属于可见外部行为，每个平台单独授权/审批/执行/验证，获得业务发布 ID/页面链接才算该平台已验证；某平台返回未知先对账，不把整组任务盲目重试，成功平台也不会重复发稿。

---

## 18. 本文结论与版本边界

**最终目标不再是“保留96场景/15步直到界面做完”，而是“以既有96/8/15为兼容安全底座，增加64个经过真实契约评审的场景，形成160目录，建立17步外层计划生命周期，把实际信息获取、策略决策、合法执行和核验收口变成产品最强能力”。**前端继续坚持极简，在首页展示最近与场景创建；复杂决策放后端，有证据才展示可用，不以华丽的 3D 卡片代替实际交付。

下列事实在本方案中始终分别陈述：**已有代码、代码专项测试通过、同 SHA CI 通过、Android 真机通过、Provider 真实账号通过、一般用户已能实际使用**。它们不能相互替代。160 是已详细列出的规划容量目标；17 是本轮新增的产品层合同目标；核心 15 步与旧 96 属于仓库既有兼容基线；完整真实执行能力仍需依照上述 PR 和门禁逐项兑现。

### 参考入口（用于工程团队定位事实与正式规范）

- 项目开发基线：`https://github.com/964896765/lazy-armor/tree/fix/rc-full-gate-real-db-concurrency`；当前核对 HEAD `c626e10`。
- 当前 main 对应失败 CI：`https://github.com/964896765/lazy-armor/actions/runs/35458096064`；后续结果须以**实际候选新 SHA** 重新检查。
- 项目代码：`packages/plan-schema/src/{product-model,domain-catalog,scenario-plan-compiler}.ts`、`apps/api/src/{ai-adapter,capability-resolver,runtime-catalog,reality-pipeline,strategy-runtime,device-tasks,mcp}`、`apps/mobile/app/(tabs)/_layout.tsx`。
- Android 后台执行与 FGS 限制：`https://developer.android.com/develop/background-work`、`https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start`。不可承诺用户手机上任意时刻无条件唤醒前台 App。
- Android 第三方 Credential Provider 与 Autofill：`https://developer.android.com/identity/sign-in/credential-provider`、`https://developer.android.com/identity/autofill`。
- 移动端安全：`https://mas.owasp.org/MASVS/`；使用 OWASP MASTG 制定独立可复现安全测试。
- MCP：`https://modelcontextprotocol.io/`；使用标准化交互，但不得交出本项目 Execution/Risk 权威。
- 可观测性：`https://opentelemetry.io/docs/`；严格过滤隐私字段。

## 附录 A｜160 场景建议目录：96 个现有 + 64 个新增（逐域清点）

**重要：**下表中“现有96”的 key 和名称取自截至本次核对的 `packages/plan-schema/src/product-model.ts`；“新增64”是本方案提出的候选场景，不是仓库中已经实现的真实能力，新增 key 需过重名/契约/合规评审后才能写入 Registry。四大空间为新版**展示映射**，并非变更原有 `money/life/work/things` 持久身份。

| 展示空间 | 领域（现有 key） | 原有场景 | 新增候选 | 规划总数 | 新增候选场景（中文） |
|---|---|---:|---:|---:|---|
| 我的财物 | 财务 (`finance`) | 6 | 4 | 10 | 跨平台消费合并；信用卡还款安排；资金流水对账；多人共享预算 |
| 我的生活 | 日常事务 (`daily_life`) | 5 | 5 | 10 | 退换货进度；水电话费联合提醒；生活服务评价与回访；当日重要事项聚合；日常安排冲突协调 |
| 我的生活 | 家庭 (`family`) | 5 | 5 | 10 | 长辈照护协同；家庭应急联系人；家庭常备药库存；亲属重要日期；家庭大件采购预算 |
| 我的生活 | 健康 (`health`) | 5 | 4 | 9 | 检查报告整理；就诊资料准备；康复训练跟进；健康数据授权共享 |
| 我的生活 | 社交关系 (`social`) | 4 | 2 | 6 | 人情往来计划；长期关系维护 |
| 我的生活 | 宠物 (`pet`) | 4 | 3 | 7 | 宠物保险管理；宠物体重趋势；寄养出行准备 |
| 我的财物 | 住房 (`housing`) | 5 | 2 | 7 | 家庭能耗分析；定期房屋安全检查 |
| 我的生活 | 出行 (`travel`) | 5 | 4 | 9 | 出行证件校验；多交通接驳协调；行李物品清单；行程费用整理 |
| 我的生活 | 休闲娱乐 (`entertainment`) | 4 | 2 | 6 | 活动开售提醒；收藏内容回顾 |
| 我的工作 | 工作 (`work`) | 6 | 4 | 10 | 会议时间冲突；工作任务交接；会议纪要行动追踪；工作报销材料准备 |
| 我的工作 | 运营 (`operations`) | 6 | 5 | 11 | 供应商报价跟踪；采购需求准备；多仓库存预警；客户回款跟进；服务工单派发 |
| 我的工作 | 内容创作 (`content`) | 6 | 4 | 10 | 内容趋势发现；素材版权核查；多平台内容排期；发布异常回查 |
| 我的工作 | 学习 (`study`) | 5 | 3 | 8 | 错题复盘；实践项目跟进；继续教育跟进 |
| 我的事务 | 证件 (`identity_docs`) | 4 | 3 | 7 | 证件遗失应对；证件使用留痕；补办材料准备 |
| 我的事务 | 政务 (`government`) | 4 | 4 | 8 | 政策条件核对；公积金变动跟进；补贴申请时限；政务办理回执跟进 |
| 我的事务 | 合同与法律事务 (`legal_contract`) | 4 | 3 | 7 | 合同版本差异；履约证据归档；授权委托期限 |
| 我的财物 | 车辆 (`vehicle`) | 6 | 3 | 9 | 停车与通行费；新能源充电准备；事故资料准备 |
| 我的财物 | 设备 (`device`) | 6 | 2 | 8 | 设备备份状态提醒；设备能耗变化观察 |
| 我的财物 | 数字账号 (`digital_account`) | 6 | 2 | 8 | 账号泄露风险提示；数字遗产安排 |

| 空间 | 已有 | 规划新增 | 合计 |
|---|---:|---:|---:|
| 我的财物 | 29 | 13 | 42 |
| 我的生活 | 32 | 25 | 57 |
| 我的事务 | 12 | 10 | 22 |
| 我的工作 | 23 | 16 | 39 |
| **总计** | **96** | **64** | **160** |

### A.1 精确 Registry 对照（现有 96）

说明：按仓库当前 `product-model.ts` 中领域种子展开；新的用户展示名称由四大空间映射单独管理，不能改掉已发布 scenario key。

| 领域 | 已有 canonical 场景 `shortKey：中文名` |
|---|---|
| `finance` 财务 | `bill`：账单；`budget`：预算；`balance`：余额；`subscription`：订阅；`refund`：退款；`abnormal_transaction`：异常交易 |
| `daily_life` 日常事务 | `delivery`：快递；`payment`：缴费；`subsidy`：补给；`appointment`：预约；`errands`：零碎待办 |
| `family` 家庭 | `family_supply`：家庭补给；`member_affairs`：成员事项；`household_tasks`：家庭分工；`shared_resources`：共享资源；`household_expense`：家庭公共费用 |
| `health` 健康 | `medication`：用药；`follow_up`：复诊；`physical_exam`：体检；`health_records`：健康资料；`habit_trends`：习惯与指标趋势 |
| `social` 社交关系 | `important_contacts`：重要联系人；`pending_reply`：待回复；`anniversary`：纪念日；`gathering_invitation`：聚会邀请 |
| `pet` 宠物 | `vaccination_deworming`：疫苗驱虫；`feeding_supply`：喂养补给；`grooming`：洗护；`health_follow_up`：健康复诊 |
| `housing` 住房 | `rent`：房租；`utilities`：物业水电；`lease`：租约；`maintenance`：维修；`home_care`：房屋保养 |
| `travel` 出行 | `itinerary`：行程；`tickets`：票务；`departure_prepare`：出发准备；`accommodation`：住宿；`trip_abnormal`：行程异常 |
| `entertainment` 休闲娱乐 | `media_games`：影视游戏；`events`：演出活动；`collections`：收藏清单；`entertainment_subscription`：娱乐订阅 |
| `work` 工作 | `tasks`：任务；`meetings`：会议；`email`：邮件；`files`：文件；`recurring_work`：周期工作；`work_summary`：工作摘要 |
| `operations` 运营 | `orders`：订单；`inventory`：库存；`customers`：客户；`after_sales`：售后；`campaigns`：活动；`business_metrics`：经营数据 |
| `content` 内容创作 | `topics`：选题；`assets`：素材；`creation`：创作；`cross_publish`：一稿多发；`publishing`：发布；`retrospective`：复盘 |
| `study` 学习 | `courses`：课程；`review`：复习；`exams`：考试；`materials`：资料；`learning_progress`：学习进度 |
| `identity_docs` 证件 | `validity`：有效期；`renewal`：换证；`preparation`：材料准备；`document_records`：证件资料 |
| `government` 政务 | `social_security_fund`：社保公积金；`tax`：税务；`government_services`：政务办理；`government_notices`：政府通知 |
| `legal_contract` 合同与法律事务 | `renewal`：到期续约；`payment_milestone`：付款节点；`performance_milestone`：履约节点；`contract_risk`：合同风险 |
| `vehicle` 车辆 | `maintenance`：保养；`insurance`：保险；`inspection`：年检；`energy`：能源；`abnormal`：异常；`daily`：车辆日常 |
| `device` 设备 | `warranty`：保修；`consumables`：耗材；`maintenance`：维护；`abnormal`：异常；`renewal`：续费；`status`：设备状态 |
| `digital_account` 数字账号 | `login_security`：登录安全；`oauth`：OAuth 授权；`connection_health`：连接健康；`memberships`：会员订阅；`storage`：容量资源；`account_cleanup`：账号清理 |

### A.2 64 个待新增场景的建议 shortKey 与目标

技术约束：先检查是否与现有场景只有“策略不同”或“参数不同”。若是同一管理对象、同一 Fact/Action 合约，应作为旧场景模板/Recipe，而不是强行新增场景凑数。真正通过唯一性评审后才分配正式 canonical key/revision。

| 领域 | proposed scenarioKey | 显示名称 |
|---|---|
| `finance` | `finance.cross_platform_expenses` | 跨平台消费合并 |
| `finance` | `finance.credit_card_payment` | 信用卡还款安排 |
| `finance` | `finance.cashflow_reconciliation` | 资金流水对账 |
| `finance` | `finance.shared_budget` | 多人共享预算 |
| `daily_life` | `daily_life.returns_progress` | 退换货进度 |
| `daily_life` | `daily_life.utilities_combined` | 水电话费联合提醒 |
| `daily_life` | `daily_life.service_feedback` | 生活服务评价与回访 |
| `daily_life` | `daily_life.daily_priority` | 当日重要事项聚合 |
| `daily_life` | `daily_life.schedule_conflict` | 日常安排冲突协调 |
| `family` | `family.eldercare_coordination` | 长辈照护协同 |
| `family` | `family.emergency_contacts` | 家庭应急联系人 |
| `family` | `family.family_medicine_stock` | 家庭常备药库存 |
| `family` | `family.relative_dates` | 亲属重要日期 |
| `family` | `family.bulk_purchase_budget` | 家庭大件采购预算 |
| `health` | `health.medical_report_pack` | 检查报告整理 |
| `health` | `health.visit_package` | 就诊资料准备 |
| `health` | `health.rehab_plan` | 康复训练跟进 |
| `health` | `health.health_sharing` | 健康数据授权共享 |
| `social` | `social.social_gifting` | 人情往来计划 |
| `social` | `social.relationship_review` | 长期关系维护 |
| `pet` | `pet.pet_insurance` | 宠物保险管理 |
| `pet` | `pet.pet_weight` | 宠物体重趋势 |
| `pet` | `pet.pet_care_trip` | 寄养出行准备 |
| `housing` | `housing.house_energy` | 家庭能耗分析 |
| `housing` | `housing.housing_inspection` | 定期房屋安全检查 |
| `travel` | `travel.travel_documents` | 出行证件校验 |
| `travel` | `travel.transit_transfer` | 多交通接驳协调 |
| `travel` | `travel.luggage_packing` | 行李物品清单 |
| `travel` | `travel.trip_expense` | 行程费用整理 |
| `entertainment` | `entertainment.event_ticket_window` | 活动开售提醒 |
| `entertainment` | `entertainment.saved_media_review` | 收藏内容回顾 |
| `work` | `work.meeting_conflicts` | 会议时间冲突 |
| `work` | `work.task_handover` | 工作任务交接 |
| `work` | `work.meeting_followthrough` | 会议纪要行动追踪 |
| `work` | `work.expense_claim` | 工作报销材料准备 |
| `operations` | `operations.supplier_prices` | 供应商报价跟踪 |
| `operations` | `operations.procurement_demand` | 采购需求准备 |
| `operations` | `operations.stock_alert` | 多仓库存预警 |
| `operations` | `operations.receivable_followup` | 客户回款跟进 |
| `operations` | `operations.service_dispatch` | 服务工单派发 |
| `content` | `content.trend_discovery` | 内容趋势发现 |
| `content` | `content.rights_clearance` | 素材版权核查 |
| `content` | `content.content_calendar` | 多平台内容排期 |
| `content` | `content.publishing_recovery` | 发布异常回查 |
| `study` | `study.mistake_review` | 错题复盘 |
| `study` | `study.practice_projects` | 实践项目跟进 |
| `study` | `study.continuing_education` | 继续教育跟进 |
| `identity_docs` | `identity_docs.lost_document_plan` | 证件遗失应对 |
| `identity_docs` | `identity_docs.document_usage` | 证件使用留痕 |
| `identity_docs` | `identity_docs.document_replacement_pack` | 补办材料准备 |
| `government` | `government.policy_eligibility` | 政策条件核对 |
| `government` | `government.fund_change` | 公积金变动跟进 |
| `government` | `government.benefit_deadlines` | 补贴申请时限 |
| `government` | `government.government_receipts` | 政务办理回执跟进 |
| `legal_contract` | `legal_contract.contract_version_diff` | 合同版本差异 |
| `legal_contract` | `legal_contract.evidence_archive` | 履约证据归档 |
| `legal_contract` | `legal_contract.delegation_expiry` | 授权委托期限 |
| `vehicle` | `vehicle.parking_tolls` | 停车与通行费 |
| `vehicle` | `vehicle.charging_plan` | 新能源充电准备 |
| `vehicle` | `vehicle.incident_pack` | 事故资料准备 |
| `device` | `device.backup_health` | 设备备份状态提醒 |
| `device` | `device.energy_behavior` | 设备能耗变化观察 |
| `digital_account` | `digital_account.account_leak_watch` | 账号泄露风险提示 |
| `digital_account` | `digital_account.digital_legacy` | 数字遗产安排 |
