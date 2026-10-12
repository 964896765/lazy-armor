# Lazy Armor Personal Life OS · 整合实施方案 V2.0

日期：2026-10-11。

任务编号：OS-DESIGN-02。交付状态：方案已整合；用户已批准实施，V91 首个切片已落地。最新代码、自动验证与现实验收边界见 [V91 实施记录](V91_GOAL_AUTHORING.md)。

本文整合用户两版升级方案与 [项目架构评审](V91_V96_PERSONAL_LIFE_OS_REVIEW.md)，用于后续增量开发。采用用户最新优先顺序：V91 需求理解/调度/投影，V92 Memory，V93 Skill–Resource Graph，V94 PC Workspace；V95 完成系统可靠性验证，V96 完成生态 Beta 联合验收。原 V84–V90 的对象、冻结合同、历史结果和待验事项继续保留，本方案不把它们改成已完成。

## 1. 产品目标

Lazy Armor 围绕用户希望达成的结果，帮助用户补齐条件、选择方法、使用真实资源、交付成果、执行合法动作、验证结果，并把可接受的经验用于下一次决策。

产品应让用户随时知道：

1. 我想完成的事情是什么，成功标准是什么。
2. 已知哪些条件，哪些是假设，哪些还需要补充。
3. 系统正在做什么，已经交付什么。
4. 当前为何等待，下一步由谁处理。
5. 结果依据是什么，核实到了什么程度。
6. 系统记住了什么，怎样修订或撤回。

核心旅程：表达目标 → 理解与必要澄清 → 选择方法和资源 → 审阅方案 → 交付/合法执行 → 检查与验证 → 下一阶段或等待 → 受控学习。

一次查询、内部提醒、报告生成、一次性操作和长期目标保留不同生命周期。系统根据需求分流，用户不用先学习这些内部分类。

## 2. 实施原则与既有资产

保留 Plan、USER_EVENT、Risk、Approval、Invocation、Shared Runtime、Execution、Verification、Reconciliation、Ledger 和 Truth 的职责、历史身份和安全边界。新增上层只能调用其合法入口。

“不动 Runtime”具体指不重写执行引擎、不改变既有执行权威、不放宽租约/幂等/审批/未知结果规则。新增业务适配器、编译器或调度策略需要时，接原协议并完成兼容验收；发现底座缺陷时单独列修复任务，不能为了保持表面零改动而绕过它。

现有模块按如下方式复用：

| 现有基础 | V2.0 中的职责 | 增强范围 |
| --- | --- | --- |
| GoalUnderstanding、GoalExecutionContext、CreationDraft、PlanningOffers、FactDemand | 理解与需求承载 | 类型化条件、来源、未知项、成功标准、版本兼容 |
| AgentPlanner、ContextCompiler、CapabilityResolver、StrategyRuntime | 统一编排与受控编译 | 协调接口、生命周期路由、解释、可恢复生成 |
| PortableSkills、Repository/Entry/Revision、PlanSkillReference | 方法目录与版本身份 | 统一检索/hash、适用性、输入输出兼容、有界组合 |
| Manifest、Connection、Device、Grant、Credential、Health | 真实能力与许可 | 目标级可用性、用途表达、来源时效、恢复入口 |
| ServicesCatalog、Offering、ServiceRequest | 现实服务供给与履约 | 与数字交付能力分区；保持原履约语义 |
| ReportGeneration、BullMQ、execution-worker | 自主提示词、资料、报告计算 | 通用计算工作单元、结构化交付、可找回成果 |
| WorkItemProjection、PlanStateAssessment、ScheduleProjection | 用户读模型 | 统一目标体验、状态正确性、主界面接入 |
| Memory、候选确认、引用、关系图、Loop Reflection | 用户上下文与结果解释 | 决策记录、经验候选、反馈消费和方法评估 |
| Admin、Mobile Web export | 运维与 Web 技术基础 | 独立用户 Workspace，复用同一 API |

先保留模块化单体与现有 API/Worker/Redis/数据库设施。目录表示职责，不表示必须拆微服务。不新增通用 Agent 循环、第二套调度器、权限中心或 Truth 存储。

## 3. 总体架构

~~~mermaid
flowchart TD
  U[用户目标] --> X[Experience Layer 手机与 PC]
  X --> Q[Requirement Engine 版本化需求]
  Q --> O[Orchestrator 协调现有 Agent]
  O --> D[DeliverySpec 服务交付定义]
  O --> S[Skill Resolver 方法选择]
  O --> C[原 Capability Resolver 资源绑定]
  D --> B[受控编译与生命周期路由]
  S --> B
  C --> B
  B --> T[临时计算 报告 合法一次性操作]
  B --> E[内部个人事项]
  B --> P[原持续 Plan 与冻结版本]
  P --> A[原 Risk Approval Invocation]
  A --> R[原 Shared Runtime Execution]
  T --> V[适用的质量检查与 Verification]
  R --> V
  E --> J[事项提醒与生命周期]
  V --> F[交付物 Result Evidence]
  V --> H[原 Truth Authority 按政策处理]
  F --> G[统一 Goal Experience Projection]
  H --> G
  J --> G
  G --> X
  F --> L[Reflection 经验候选]
  L --> M[已有 Memory 或新方法 Revision]
  M --> O
~~~

这是一张职责图，不是强制串行调用图，也不替代现有事务顺序。方法选择与资源解析可反复协调；缺资源时先说明缺口或形成等待。内部提醒不强制创建 Plan，报告不强制创建外部 Invocation，所有外部动作仍走原批准入口。

分成三条协作链：

- 需求与生成链：输入、澄清、方法参考、方案与报告；由持久化计算工作单元管理。
- 合法执行链：原生命周期、冻结版本、权限、风险、审批、Runtime、验证和对账。
- 体验与反馈链：从上述权威读取阶段、结果、阻碍和下一步，产生受控经验候选。

## 4. Requirement Engine：把表达变成可追溯需求

### 4.1 最小 GoalBrief 合同

建议新增共享合同 goal-brief.v1，表达以下语义：

| 字段 | 内容 |
| --- | --- |
| schemaVersion/contextRef | 合同版本及原 Conversation/Draft/Plan 引用 |
| title/desiredOutcome | 简明目标及需要交付/达成的结果 |
| motivation/currentSituation | 动机与当前状态；没有时保留未知 |
| constraints | 预算、地点、时间、规模、领域限制等带单位条件 |
| resources | 本人声明的可用资产/资料与已核对资源引用，二者区分 |
| successCriteria | 本次交付、现实结果或本人决策的可检查标准 |
| unknowns/assumptions | 缺失条件、可继续使用的假设及其影响 |
| riskPreference | 用于方案排序；不覆盖实际动作 Risk |
| fieldProvenance | 每个关键字段的状态、来源、时间及适用版本 |
| lifecycleSuggestion | 临时/内部事项/持续目标的建议及理由，不授予执行权 |

字段状态采用 USER_STATED、CONFIRMED、ASSUMPTION、UNKNOWN，与已实现的 goal-brief.v1 一致。用户确认的声明不自动成为外部现实 Truth；ASSUMPTION 不能随着报告生成成功升级为事实。空预算不能用零预算代替，地点未知不能由模型补成用户所在地。

来源引用可指向原用户消息、已确认 Memory 版本、上传材料、当前 Truth 或明确标识的模型假设。引用资源时不复制密钥或长期凭据到需求合同。

### 4.2 需求完整度与澄清

不设置统一“confidence ≥70 就生成或执行”规则。模型自评只作辅助解释，真正决策基于具名检查：

- 哪些信息是本次交付必须具备的。
- 缺项是否改变成本、外部动作、授权范围或重要成功标准。
- 当前条件是否互相冲突。
- 哪些缺项允许在明确假设下继续。
- 哪些缺口属于资源/权限问题，而不是用户表达问题。

READY_FOR_PROPOSAL 仅表示可以形成建议；READY_FOR_DISPATCH 由原执行链判断。二者不得合并。

每轮优先集中问少量会改变方案的关键问题，保留已有回答。“我要创业”可以先问项目方向和预算范围；“每天汇总 GitHub 日榜前十，所有语言”已经具备核心交付条件，不再追问创业式问卷。

状态、进度查询走读 API，不作为新的需求修改消息。否则一句“进度怎样”可能使旧报告被需求版本变更替代。

### 4.3 存储与版本

V91 复用原 CreationDraft 与消息 structuredPayload；已实现为可选 goal_brief_json 和按原 PlanVersion 固定的 plan_goal_briefs 元数据 sidecar。原 CreationDraft.goalJson、PlanCreationContract.goalJson 及其 hash 保持不变，不增加平行 requirements 权威。新增 sidecar 只保存完整需求与来源 hash，不控制执行或 Truth。

现 ScenarioGoalSpec 是 strict 合同，扩展必须有显式新版本及适配器。旧合同保持可读和不可变；未知版本不能确认执行。只有实际影响动作的条件经原编译器进入 PlanDefinition，不把完整个人背景默认传给所有工具。

使用原 Conversation/Draft CAS 保护编辑，分别引用 PlanVersion、Skill Revision、Memory 版本和授权快照。一个“Goal 版本”不能替代这些不同的围栏。

未来跨多个 Plan 的长期目标确需聚合时，新增 GoalWorkspace 管理阶段、成功标准、子目标和成果索引。它不掌握审批、调度或执行权限。

## 5. Orchestrator：统一协调与可恢复生成

### 5.1 推荐模块结构

~~~text
apps/api/src/requirements/
  requirements.module.ts
  requirement.service.ts
  requirement-readiness.ts
  requirement-adapter.ts

apps/api/src/orchestrator/
  orchestrator.module.ts
  orchestrator.service.ts
  goal-analyzer.ts
  skill-resolver.ts
  resource-resolver.ts
  plan-generator.ts
  execution-router.ts
  handlers/
  authoring/

packages/plan-schema/src/
  goal-brief.ts
  authoring-job.ts
  delivery-spec.ts
  goal-experience.ts
~~~

这些是建议职责和文件名，不是本轮已创建的实现。模块避免循环依赖：Consumer 负责入口，Orchestrator 协调共享服务，worker 调用计算处理器；Orchestrator 不反向调用 Consumer Controller。

| 组件 | 负责什么 | 复用入口 |
| --- | --- | --- |
| goal-analyzer | 归一化需求、检查缺项、选择生命周期 | GoalUnderstanding、GoalExecutionContext、Requirements |
| skill-resolver | 选择方法候选及解释理由 | PortableSkills/Repository/Revision |
| resource-resolver | 提出能力要求，读取目标级可用性与缺口 | 原 CapabilityResolver、Usability、ResourceGap |
| plan-generator | 生成并校验 DeliverySpec、Proposal 或 Plan Draft | ContextCompiler、CreationDraft、原受控 Recipe |
| execution-router | 选择合法交接入口及返回引用 | 原确认、USER_EVENT、一次性操作、Plan 链 |
| authoring/handlers | 持久化计算、阶段反馈、超时、取消与恢复 | 原 Redis/BullMQ/Worker；现报告适配器 |

### 5.2 生命周期路由

| 用户需求 | 路由与结果 | 执行边界 |
| --- | --- | --- |
| 查询状态或简单回答 | 当前对象读取或回答交付 | 不能因查询创建外部动作 |
| 生成商业报告/内容计划 | TEMPORARY 计算 job 和 Artifact | 来源读取仍核对许可；无虚构 Plan |
| 明天提醒我办事 | USER_EVENT 建议与原确认 | 默认内部提醒，不要求日历连接 |
| 同步到手机日历 | 显式外部同步请求 | 原冻结请求、风险/审批、Runtime |
| 合法一次性外部操作 | Action Proposal → 原一次性确认 | 原权限、版本、Risk、Invocation |
| 每天关注 GitHub/长期推进目标 | CreationDraft → 原 Plan/PlanVersion | 本人启动与自动化政策，原持续调度 |
| 尚未支持的领域/能力 | 解释需求、草稿或能力缺口 | 不编造可执行 Recipe 或 Provider |

“生成建议”“审阅草稿”“允许资源读取”“批准外部动作”“启动持续计划”是不同语义，可以在体验上连贯展示，但不能相互冒充。

### 5.3 持久化 Authoring Job

普通会话先写 PROCESSING 再等待模型的恢复风险，是 V91 首批必须解决的问题。Authoring Job 管理“已保存输入 → 已校验建议/报告”的计算过程，不占用未获授权的 Execution 或 TaskGraph。

建议最小字段：id、userId、conversationId、requestId、inputMessageId、inputHash、sourceConversationVersion、可选 draft/version 和 planVersion、status、stage、revision、attemptCount/maxAttempts、leaseToken/leaseExpiresAt、cancelRequestedAt、outputRefs/resultMessageId、errorCode、创建/更新时间。

状态：QUEUED → RUNNING → SUCCEEDED/FAILED/CANCELLED/SUPERSEDED。CLARIFICATION_REQUIRED 是一次成功生成的澄清结果，不让 job 永久等待用户。

必要规则：

1. 输入与 job 同事务保存；同请求标识不同内容拒绝。
2. 入队失败可通过原 outbox 或有界恢复扫描补齐。
3. claim/续租/提交校验 leaseToken、revision 及相关上下文版本。
4. 超时、费用、重试和取消有明确上限；旧 worker 不能重新发布。
5. 用户更新关键输入、归档、删除或取消后，迟到结果被替代或拒绝。
6. 每次实际来源读取前检查当前许可；提交时检查相关版本与来源权威。
7. 模型在途取消不能保证零计费，必须保证迟到结果不触发新执行。
8. 日志记录模型身份、合同版本、阶段和安全错误码，不记录密钥。

若现有存储不能支持租约/索引/恢复，允许增加一个最小 authoring_jobs 表，这属于新增计算工作单元的必要数据，而不是复制 Plan/Execution。报告先以适配器接入，其原 stage/revision 仍保持来源权威；迁移到统一 job 时必须一次明确权威切换，避免两份独立状态同时更新。

## 6. Skill、Resource、Service 的统一合同

### 6.1 Skill：版本化方法

沿 Repository → Entry → Immutable Revision → 冻结引用，增强适用条件、输入输出 schema、必要事实、能力需求、失败行为、检查方式、来源许可和完整内容 hash。

方法选择先检查：版本有效、输入输出兼容、能力存在、适用条件和政策限制，再比较相关性、成本与质量。简单事项可选 0 个方法。没有适用方法时说明缺口或走已有合法直达路径。

规范化 hash 覆盖完整语义，包括 frontmatter、输入输出、能力/工具声明、限制、验证要求和正文。官方 Registry 与导入 Revision 统一不可变版本身份，current pointer 与历史版本分开。历史运行引用不因修正 hash 被改写，采用新合同/Revision 渐进迁移。

方法质量来自版本级真实验收样本，给出样本量、时间、失败原因和限制。模型生成的“95 分”不作为质量证明；方法自报风险不能降低原动作风险。

### 6.2 Resource：提供能力的具体绑定

~~~text
CapabilityDefinition：能做什么，输入输出和边界是什么
ResourceBinding：哪个设备、账号、文件或网站范围提供
Grant / Credential / Health：当前是否允许、有效和健康
Invocation：这一次经批准的调用
Connector / Adapter：具体接入实现
~~~

ResourceRequirement 沿原 CapabilityRequirement 表达 canonical capability、操作、资源类型、字段、用途、目标范围、最低事实等级、最大年龄、风险和成本上限。初版不创建第二套 manifest。

绑定快照引用实际 Connection/Device、manifest revision/hash、Grant/Health/evidence 身份与检查时间。快照用于解释，不授予权限；实际调用继续检查当前权威。

UI 区分：目录中已有、待接入、已连接、待授权、本目标可用、本次需审批。微信/支付宝等候选不能展示为已经支持全量读取或发送。可用资源不足可以先交付合法草稿，真实执行阶段再补所必需的能力。

### 6.3 Service：成果交付定义

数字服务使用 DeliverySpec，至少包含：schemaVersion、需求版本引用、可选模板版本、methodRefs、输入事实、假设、资源需求、输出 schema、验收规则、费用/期限/尝试上限、人工决策点和内容 hash。

验收器首版只允许平台实现的有限类型：Artifact schema、程序断言、read-back、Provider receipt、用户审阅。作者不能上传任意代码或 DSL 作为可信验收器。

ServiceDefinition 是可复用 DeliverySpec 的不可变模板；ServiceInstance 是某次交付的关联索引，状态从原 job/Plan/Execution/Result 投影。首批先用一个官方交付模板，不建设完整服务市场。

现实 ServiceOffering/ServiceRequest 保留原供给、价格、接受和履约语义，可以作为组合里的人工服务步骤。能力中心主要展示数字成果能力；服务页继续承载现实履约，未来确需统一发现时通过分区投影连接，避免混淆状态。

## 7. V93 Skill–Resource Graph：可校验的组合

Graph 初版是本次交付的有界规划/编译 DTO，不是全局图数据库，不是多 Agent 网络，也不是新的执行状态机。

节点：METHOD（确切 Revision）、RESOURCE_REQUIREMENT、OUTPUT。

边：REQUIRES_CAPABILITY、CONSUMES_OUTPUT（带字段映射）、PRODUCES。

编译检查：输入输出类型、字段映射、缺失输入、环、节点/深度上限、范围、费用、验证方式以及原 Runtime Recipe 是否支持。通过后冻结方法、模板、映射和编译 hash；实际执行图仍由原合法 Execution 创建。

当前最多 3 个方法，V91 沿用已有有界合同。V93 才按实际需要版本化扩展，并同步上下文/预算/编译限制与验收；不能只放大数组上限。初版优先顺序组合，独立只读研究的并行在测量和取消/预算支持完成后扩展。

运行失败后的资源替代必须满足原能力与授权范围并重新校验；OUTCOME_UNKNOWN 外部动作只能核对，不得由 Graph 换 Provider 重发。旧 PlanVersion 不随方法 current pointer 变化。

## 8. Artifact / Report：让成果可找回、可核对

报告、摘要、对比表和内容计划成为独立可引用成果，不只藏在聊天消息中。复用现有 artifact 与报告内容，逐步增加索引和版本，不先复制整套文件存储。

建议描述：类型、状态、需求/方法/模板版本、内容/hash、结构化章节和数据、自动提示词、模型身份、来源与时间、假设、程序模型版本、质量检查、限制、分享操作。

四个维度分开：

| 维度 | 表示什么 |
| --- | --- |
| 生成状态 | 排队、分析、研究、撰写、检查、已生成、失败、被替代 |
| 来源等级 | 用户输入/上传、公开来源响应、模型假设、程序计算、原权威核实 |
| 交付质量 | 完整性、引用定位、计算一致、限制披露、输出合同通过 |
| 目标成功 | 已确认成功标准是否达到，是否可进入下一业务阶段 |

报告 COMPLETED 表示完成该次报告交付，不表示市场事实核实或成功开店。ACK 不等于验证，站内通知持久化不等于系统推送送达。

专业报告应包含：结论、方法/范围、来源、假设、备选方案、程序测算、敏感性、风险、待核实项和下一步。关键数字有单位、时间、地域和来源身份；未知量保留未知。商业评分给指标和权重，缺数据不自动填中值。

App 自主生成提示词、选源、写作和检查，用户可以查看生成依据。提示词/网页/导入方法均不能改变系统权限与指令边界。

V91 先统一旧报告状态与可找回入口；V93 扩结构化交付及组合；V94 在 PC 提供完整 Markdown/表格/图表/方案比较阅读。

## 9. V92 Memory：受控学习与决策记录

复用已实现的 Memory 开关、来源、确认、版本、有效期、删除及关系。用户提出的四类记忆分别映射到现 PROFILE/PREFERENCE/ASSET/DECISION/HISTORY 等类型，不新增平行 memory 表。

| 信息类别 | 来源权威 | 使用方式 |
| --- | --- | --- |
| 用户资料、偏好、资产 | 原 PersonalMemory 与确认候选 | 仅在本人允许且当前版本有效时检索 |
| 现实事实 | 原 Truth/Reality | 引用证据和有效期，不复制成第二事实库 |
| 执行历史 | Execution/Result/Audit | 自动累计只读结果统计，保留未知和失败 |
| 决策/经验候选 | GoalBrief、已验证结果、用户理由 | 受控接受/评估后影响下一次建议 |

LearningCandidate 最小内容：类别、需求版本、执行/结果/evidence refs、建议内容、适用情境、局限、样本量、时间、有效期和 PROPOSED/ACCEPTED/REJECTED/EXPIRED 状态。

反馈闭环：预测/预期 → 实际观察 → 验证 → 差异解释 → 经验候选 → 接受或评估 → 下次规划使用依据。

系统可以自动形成候选和只读统计；长期个人资料/偏好沿现本人确认机制保存。UNKNOWN 不形成成功经验。方法优化产生新 Revision，经对比评估后使用，不自动更改风险策略、授权、运行中的 PlanVersion 或自动化政策。

取消 Memory、删除来源、撤回候选后，未来检索和结果发布检查必须生效；历史执行仍说明当时使用的版本与依据。需要撤回/清理衍生产物时沿独立保留策略处理，不能通过改写历史 Ledger 假装从未发生。

## 10. Experience Layer：手机与 PC 使用同一目标

### 10.1 Mobile 信息架构

保留日程｜计划｜会话｜资源｜服务五导航。“今天”是日程首页，“我的目标”和“能力中心”归计划二级，资料/隐私/设置继续从已有入口进入。

| 页面 | 展示 | 主要操作 |
| --- | --- | --- |
| 日程/今天 | 跨日目标、需要处理、进行中、最新成果、接下来 | 补信息、确认、查看成果、恢复原目标 |
| 计划 | 目标、成功标准、阶段、已验收成果、下一步；能力中心 | 新建、审阅、调整、暂停、恢复、结束 |
| 会话 | 想完成什么、理解摘要、条件、假设、方案讨论 | 更新需求、选择方案、返回目标空间 |
| 资源 | 手机、账号、文件等资产及逐项能力/范围/状态 | 接入、授权、撤回、检查、恢复 |
| 服务 | 现实服务供给与履约进展 | 请求、确认、跟进及问题处理 |

首页可提供创业、旅行、学习、创作、家庭等目标示例；它们是输入引导，不是已实现所有领域的承诺。能力中心以“创业评估”“旅行规划”等成果命名，方法版本放详情，缺资源显示“需要配置”。

### 10.2 统一 Goal Experience Projection

扩现有 WorkItemProjection、PlanStateAssessment、Plan 控制投影，形成共享只读合同。V91 先以 contextRef（Conversation/Draft/Plan 的真实引用）表示目标，不凭空制造 Goal ID 或目标表；未来 GoalWorkspace 引入后保持兼容映射。

最小内容：标题/结果目标、需求版本、已知条件/未知/假设、成功标准、业务阶段、里程碑、成果 refs、运行阶段、阻碍、待处理项、nextBestAction、方法/资源引用、成本上限、结果与验证等级、evidence refs、sourceVersions、evaluatedAt/freshness、失败及截断标识。

业务进度与运行进度分开。先显示“已验收 2/5 个里程碑”；只有已确认完整分母、权重和验收规则时才显示百分比。持续关注显示最近检查、下次检查、实际覆盖日期和异常，不显示“完成40%”。

投影中的动作是可请求的命令入口，不代表已批准执行。提交必须重新核对源对象、版本、权限与状态。缺数据显示未知/暂不可读取，不从中文标签或缓存猜权限。

报告阶段必须先于 ANSWER 大类决定是否完成；原 FAILED、PARTIAL、UNKNOWN 保留。旧 Ledger 的 UNKNOWN 即使后来经对账查明，也保留原历史，并展示当前核实结论。

### 10.3 确认体验

确认按真实决策和权限发生，不按模块逐个弹窗：关键缺项集中问；方案一次展示目标、假设、资源、成本及自动化政策；新增范围仍沿原逐项授权；执行审批仍由原政策决定。

已回答条件、已有效授权和已审阅确切版本不重复索取。正常只读刷新、阶段切换、已批准范围内的合法重复运行不追加确认。实质改变目标、成本、外部动作、权限范围或成功标准时，重新审阅相关部分。

### 10.4 V94 PC Workspace

左栏：目标、计划、资源、能力；中栏：目标空间、报告、对比与方案编辑；右栏：有依据的下一步、待处理、风险和来源。Admin 运维独立。

首版：目标总览、完整报告阅读、方案审阅、资源补齐/手机接力。随后扩复杂计划编辑与管理。

两端使用同一原对象 ID、版本、Projection 和命令 API。PC 修改后手机旧审批失效；手机审批提交后 PC 刷新。PC 不替手机取得系统权限，手机离线时显示当前证据不足。新用户 Web 应用可建议放 apps/workspace，复用共享合同，具体框架采用仓库现有技术优先。

## 11. API、数据与性能

### 11.1 API 增量策略

保留 conversations、creation-drafts、确认、资源、计划、审批及执行命令。新增稳定用户读模型和计算 job 读取；新路由只作 BFF/Facade，不复制原 CRUD。

拟定新增接口：GET /consumer/experience、GET /consumer/goal-experience（contextType/id）、GET /consumer/authoring-jobs/:id。需求更新优先扩现 draft-input/creation-drafts 合同。精确 URL 在 V91 合同任务中统一冻结，以上不是当前已实现 API。

原 POST /conversations/:id/messages 逐步支持持久化受理并返回 jobRef；通过显式协议版本/客户端能力兼容旧响应。旧客户端继续保留可用行为，新客户端使用 job/projection 跟踪；不能无版本直接把原 JSON 改为202破坏消费。

用户、内部 worker、设备签名与 Admin 身份分别认证和授权。/api 与 /internal 路径本身不构成隔离。聚合读取仍检查 owner，不能因为某个 Ref 传入就暴露别人对象。

### 11.2 数据新增原则

| 数据 | 首版策略 |
| --- | --- |
| Requirement/GoalBrief | 扩原 Draft/消息/冻结创建合同，不另建平行需求库 |
| Skill | 扩原 Repository/Entry/Revision，不建第二 skills 表 |
| Resource | 引用原 Connection/Device/Grant/Health，不建第二权限状态 |
| Memory | 扩候选/决策/经验合同，复用现存储 |
| Authoring Job | 如现承载不足，新建最小计算 job 表，理由是租约/恢复/索引 |
| Delivery/Artifact 索引 | 先复用现 artifact、report；证明确需独立历史检索时追加 |
| Graph | JSON DTO 与不可变编译引用，首版不引图数据库 |
| Schedule occurrence | 接原调度的持久化时槽身份；默认兼容旧触发语义 |

所有 SQL additive/append-only，保留原表、历史合同和 Ledger。新的本地 additive 迁移与生产发布证据分别记账；0083 的既有发布门不能被新表绕过。

### 11.3 快速响应与成本

缓存方法目录、用户允许的上下文摘要、历史成果索引和只读投影；key 至少隔离 owner 与相关版本/许可变更。资源缓存带 observedAt/stale/reasons，执行前重查当前权威。

模板缓存结构与方法版本，用户事实、价格、授权和资源当前状态不跟随模板缓存。报告/研究/组合编译后台执行，受理后即返回身份与实际阶段。

每个计算 job 设总模型费用/token、墙钟时间、来源数量/大小、并发、重试和取消规则。现有单次90秒超时不等于全任务费用或耗时有界。分用户限额和公平队列纳入预算设计，超限解释等待或停止，不通过无限重试完成。

先用有界轮询/ETag共享状态，需要更快同步时增量接 SSE/原 outbox 事件。没有同类耗时样本前显示阶段；有样本后给带区间与更新时间的预计耗时。

以下是建议验收目标，需在实施后记录实测环境及结果，不是现有性能承诺：受理 p95≤2秒；约定100项内投影 p95≤1秒；在线健康两端状态同步 p95≤5秒；目标与成果两次点击内找回。模型/外部网络耗时、用户等待、后台 OS 送达分别统计，不混成一个接口延迟。

## 12. 可靠性：从 V91 纳入，V95 系统验证

必须覆盖：保存后入队失败、模型中断、迟到响应、重复投递、版本冲突、资源撤权/到期、设备离线、计划暂停、未知结果、通知送达、跨日停机与恢复。

计算重试与外部动作重试分别处理。无副作用计算允许有界重试；外部写入结果未知先 read-only Reconciliation，不能通过重建 Plan、换 Target 或新 Orchestrator 请求再次写入。

持续调度沿原 tick/dispatch 增强 occurrence 身份和 misfirePolicy：SKIP、CATCH_UP_LATEST、BOUNDED_CATCH_UP。默认保留旧版本原语义，改补发策略需原新版本审阅。补读今日榜单明确标记实际读取时刻，不补造昨日来源或七日证据。

通知分开统计生成、站内持久化、OS push 请求、送达和已读。只有相应实际证据才显示已送达；手机离线不把站内结果自动投影为推送成功。

观测链引用 request/job/Conversation/Draft/PlanVersion/Execution/Invocation/Artifact，便于解释原目标。既有历史身份不改，新增日志和指标不取代 Audit/Ledger。

## 13. V91–V96 路线与关闭标准

每版包含 Backend、Frontend、Database、Runtime integration、Tests、Real Evidence 和状态记录。完成目录、typecheck 或 APK build 不等于完成用户旅程。

| 版本 | 本版主交付 | 必须完成的闭环 |
| --- | --- | --- |
| V91 目标入口与统一调度 | GoalBrief、Orchestrator、UserProjection；持久化需求生成与状态修正 | 输入目标→必要澄清→合法方案/报告→离开页面→原目标找回；中断/更新/撤权保持正确 |
| V92 Memory 与反馈 | 复用记忆，接决策记录与经验候选 | 已验证结果→建议保留→接受/拒绝→下一次建议消费→关闭/删除生效 |
| V93 方法资源组合与交付 | typed Graph、DeliverySpec、版本/hash统一、结构化成果 | 一个真实多方法+实际资源目标通过受控编译、原执行/验收与恢复 |
| V94 PC Workspace | 目标空间、专业报告阅读/比较、方案编辑、手机接力 | PC审阅/调整→手机处理合法许可或审批→原执行→两端相同版本和结果 |
| V95 可靠性与规模验证 | 恢复/漏跑/去重/预算/公平性/性能、原链故障矩阵收口 | 真实连续多日、停机恢复、撤权/暂停、未知结果、无重复副作用，实测SLO |
| V96 Personal Life OS 生态 Beta | 第三方发现、版本质量、数字交付目录与联合体验 | 实际第三方方法/资源交付、本人跨目标连续使用、学习可控、发布门通过 |

2026-10-12 V92首批见[决策与受控学习](V92_DECISIONS_AND_LEARNING.md)：报告版本绑定的本人决定及连接服务经验候选均复用原Memory，撤回/发布前来源检查接通；真实保存→后续模型理解→来源找回子闭环通过，更广适配与真实经验仍待验。V93[能力组合](V93_SKILL_RESOURCE_COMPOSITION.md)合同、预览API与手机入口已实现并安装，继续原合法编译及实际多方法旅程。V94[工作台首批](V94_WORKSPACE_FOUNDATION.md)复用消费者Web/投影新增三栏目标与报告空间，代码/构建通过，浏览器画面和认证旅程待验。不关闭整个版本或原现实验收。

Memory/Resource 的已有能力从 V91 即参与；权限/owner/不可变引用/恢复也从 V91 就执行。V92/V95 表示深化与系统性验证，不是此前允许缺失这些基础。

分类目录可以先做，公开 Marketplace、支付、创作者激励和大规模跨领域商业化以可靠交付证据为前提，不纳入 V91。

## 14. V91 详细任务拆分

顺序：合同 → 可恢复入口 → 原链交接 → 统一投影 → Mobile → 完整验收。开发只展开当前切片；后续版本可准备无依赖设计，不同时建设四套系统。

| 任务 | 内容 | 依赖与验收 |
| --- | --- | --- |
| V91-00 权威与兼容合同 | 生命周期矩阵、对象/版本来源、API兼容、迁移策略 | 旧消息/Draft/PlanVersion仍可读；未知新版本不能执行 |
| V91-R01 GoalBrief v1 | 需求/来源/假设/未知/成功标准 schema 与原存储适配 | 条件可追溯；模型猜测不能成为用户事实 |
| V91-R02 必要澄清 | 具名完整性检查、冲突、少量关键补问 | 模糊需求可澄清；完整需求直接生成，不反复问已答内容 |
| V91-R03 冻结与修改 | 原CAS和确认绑定，关键输入更新使旧建议失效 | 旧合同不改；迟到结果不能覆盖新需求 |
| V91-O01 注册路由 | 原回答/报告/事项/一次性/持续处理器接入协调层 | 路由理由可见；不支持能力不生成假执行 |
| V91-O02 Durable authoring | 输入/job原子保存，队列、租约、预算、取消、恢复 | 保存后未入队和模型中断均恢复；重复提交只形成一份合法结果 |
| V91-O03 受控编译交接 | 单官方Delivery模板，方法/资源解析，原合法确认入口 | 保留当前方法上限；编译不授予执行权 |
| V91-O04 来源与恢复门 | 权限、相关版本、归档/删除/迟到holder检查 | 撤权阻止后续I/O或发布；资源恢复回原目标 |
| V91-U01 Experience合同 | 汇总需求/job/报告/Plan/验证/下一步 | 报告排队/生成/失败不误计完成；未知保持未知 |
| V91-U02 Mobile接入 | 日程目标摘要、需求卡、成果、下一步；接原WorkItem | 重启后两次点击内找回；五页结果一致 |
| V91-U03 查询与兼容 | job进度读取、projection分页、旧接口兼容 | 查询不替代原目标；owner隔离、时效、截断明确 |
| V91-T01 联合验收 | 真实入口、相关专项、恢复矩阵、发布证据分类 | 自动测试、真实资源、本人体验分别记录；不关闭旧待验事项 |

V91 首个可运行切片只选择荆门洗车店评估报告：输入/已确认假设→需求合同→协调已有生成链→统一状态→找回报告与下一步。暂不开放新的 Android Input、抖音发布、任意工具或通用自我修改。

已有 GitHub 草稿、审阅和网站授权继续保留，按其原入口收取首次真实运行；不为新方案复制目标或重复要求许可。

## 15. 三条标准用户旅程

### 15.1 荆门洗车店商业评估

使用本人已确认的城区/租赁/2–3工位人工洗车+基础美容情景。未知预算、实际租金、客流和产能继续明确。成功标准是可审阅商业评估交付，不是证明开店成功。

系统自主形成提示词和研究计划→选择已授权资料→引用原文→程序计算多情景→质量检查→报告/对比/风险/待核实→本人决策→下一阶段。背景官网原文不能代替当地经营参数实地核实。

关键输入更新生成新版本，旧报告保留适用条件；用户可以从日程/计划/PC找回同一成果。本人审阅报告不自动把假设写入Truth。

### 15.2 GitHub每日公开日榜

保留本人目标：所有语言、每日前10、北京时间09:00、中文汇总、原GitHub网站范围。计划启用、实际读取、模型生成、站内通知、OS送达分别记账。

七日证据只统计七个连续实际日期的真实行为，成功、失败、漏跑、等待分开。验收口径在运行前冻结；日期有记录不自动证明成功，fixture/未来时刻/人工补历史不计真实连续运行。

此链用于验证持续性、权限变更、漏跑和重启恢复。既有记录显示计划仍draft且无首次Execution；本方案不宣称已经启动，也不重复索取已完成的审阅/授权。

### 15.3 短视频账号30天计划

先明确内容方向、可投入时间、现有素材和本次成功标准。若只是需要30天计划，先交付定位、选题、脚本示例、拍摄/剪辑安排和验收指标；不要求先接入摄像头或发布平台。

只有真实实现且授权的热点/素材/发布能力才参与读取或执行。抖音发布未接入时显示缺口，不能因为方法声明需要抖音就认为可以发布。后续实际表现经合法读取/核实后，形成调整建议和受控经验。

## 16. 验收门、观测与发布

每项交付分别通过：Contract（schema/兼容/版本）、Runtime integration（原链/租约/幂等）、Product（入口/状态/恢复）、Real Evidence（实际模型/来源/本人结果）四类门。

必须验收的安全与一致性场景：

- 不完整目标只产生必要澄清，零未经授权外部副作用。
- 更新需求后旧结果、旧审批或旧方法引用不能静默提交。
- 排队后撤权、Memory关闭、来源删除在读取/发布相应检查生效。
- 进程中断、丢失入队、重复投递和旧holder不会重复交付或产生新动作。
- USER_EVENT、日历同步、一次性操作、Persistent Plan保持各自原合同。
- Report完成、市场核实、Execution成功、ACK、OS送达和目标成功不混淆。
- 投影/缓存/Graph均不能授予执行或Truth权威。
- 已验证里程碑100%可引用对应证据及时间；持续计划不制造最终完成百分比。

正式CI继续包含类型/相关回归、数据库安全与隔离、MySQL8.4/备份恢复、build和Android产物。新增模块/分支要更新CI选择范围，避免新版本分支遗漏完整门。没有远程运行证据不写GitHub Green。

真实数据缺失、手机离线或第三方暂不可用时，保留待验并推进独立工作。旧V87外部Act/read-back、V88真实七日、V89第三方、V90联合以及0083发布门不会因为版本升级自动关闭。历史依赖审计问题需在允许联网的正式验证中刷新和处理，本次方案编写未重新扫描。

## 17. 方案交付历史与当前实施

用户批准“按方案执行”后，V91需求合同、原链协调、持久化Authoring、只读Goal Experience与Mobile首批实现和自动验证完成。2026-10-12首个荆门报告场景完成授权官网原文、App自主提示词/正文、预算更正、取消/继续、重启找回和本人查看，详见[V91实施记录](V91_GOAL_AUTHORING.md)与[真机验收](V91_DEVICE_JOURNEY.md)。跨领域、全任务费用配额/性能与历史发布门仍为独立深化/待验，不由本场景覆盖。以下保留方案交付当时的范围。

Backend：已明确理解、调度、持久化计算与原链交接边界；本轮未改实现。

Frontend：已明确五导航目标体验、统一读模型和PC工作台；本轮未改页面。

Database：已明确复用与必要新增条件、版本兼容和迁移门；本轮零SQL操作。

Runtime：保留原执行权威；后续增强通过业务适配器/合法协议接入。

Test：本轮仅做文档一致性、链接及原文件保护检查；上一轮类型/测试结果见评审，不冒充本轮重验。

完成状态：V2.0总方案交付；未开始V91实现、未启动个人计划、未提交/推送/发布。

下一实施任务：V91-00/V91-R01，冻结权威矩阵与GoalBrief兼容合同，再形成荆门报告的单场景闭环。每个任务以原对象、明确证据、可恢复用户体验为完成标准。
