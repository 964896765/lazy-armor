# V91–V96 Personal Life OS 路线评审

评审日期：2026-10-11。基线：c3f47c9，包含当前工作区原有的 12 个独立登录/设备 Runner 改动。

任务编号：ARCH-REVIEW-91。状态：REVIEW_COMPLETE；本轮未开始 V91 实现。

## 1. 结论

用户方案符合 Lazy Armor 的长期方向，但不能作为六个新引擎依次建设的直接开发任务书。当前项目已经按 Personal Life OS、Goal 入口和受控执行链设计，Agent、Task、Memory、资源能力、版本化方法、报告后台生成及消费者投影均有实现。把这些再建一遍，会形成多个目标状态、权限判断和执行入口。

方案能补上产品表达、需求结构化、组合交付和 PC 工作台，但尚不足以完成“个人生活操作系统”。还必须明确：目标成功标准、方法组合如何编译、交付物与事实验证的区别、后台需求处理的崩溃恢复、定时错过策略，以及学习怎样影响下一次决策。

建议采用增量设计：版本化 GoalBrief → 现有 Agent 编排 → 方法与能力解析 → 受控编译 → 原权威链 → 交付物/证据 → 统一体验投影 → 受控经验候选。V91–V96 按完整用户闭环验收，避免按模块目录完成度推进。

本轮评审覆盖源码结构、关键业务链、共享合同、数据库承载、Mobile、Admin、异步工作、CI 和现有验收记录，并重跑全仓类型检查与相关本地测试。没有重跑生产迁移、真实数据库集成、手机操作、真实第三方组合或连续七天运行，不能把本轮评审当作这些验收已完成。

## 2. 方案与当前实现的对应关系

| 用户方案 | 当前实际基础 | 应补齐的内容 | 建议处理 |
| --- | --- | --- | --- |
| Requirement Engine | GoalUnderstanding、GoalExecutionContext、PlanningOffers、CreationDraft、FactDemand | 可版本化需求、字段来源、未知项、成功标准、阶段条件 | 扩现有合同，不建立第二套需求权威 |
| Orchestrator | AgentPlanner、ContextCompiler、CapabilityResolver、StrategyRuntime、TaskScheduler | 统一入口、组合决策、持久化生成工作、跨阶段恢复 | 作为原 Agent 的协调层，不执行工具、不写 Truth |
| Skill Registry/Resolver | 官方 PortableSkill Registry；Repository/Entry/Immutable Revision；PlanSkillReference | 统一检索、适用性、输入输出兼容、组合编译、质量证据 | 增量完善现有仓库与合同 |
| Resource OS | Provider manifest、Canonical Capability、Connection/Grant/Credential/Health、Usability/Resolver | 用途化产品表达、具体目标的可调用理由、真实覆盖 | 保留现有权限及能力权威 |
| Service System | 现实服务方、Offering、Request、履约状态 | AI 组合能力的交付合同、结果 schema、验收标准 | 增加组合交付定义；现实服务语义继续保留 |
| Report Engine | 自主提示词、研究、撰写、程序测算、检查、后台队列、App 报告页 | 通用交付物、结构化阅读、方案比较、证据充分性、版本管理 | 抽取现有报告工作流并增强 |
| User Projection | Consumer、WorkItemProjection、PlanStateAssessment、ScheduleProjection | 主界面真正接入、统一结果语义、业务阶段和成功标准 | 收敛投影，禁止客户端猜测执行权限 |
| PC Workspace | Next.js Admin；Mobile Web export | 用户工作台、报告阅读、目标编辑、多端协同 | 新建用户体验表面，共用 API 和权威链 |
| Memory OS | 默认关闭的个人记忆、候选确认、引用版本、删除、关系图、Planner 消费 | 结果衍生经验、决策记录、版本级方法评估 | V91 即复用存储，V96 重点补学习闭环 |
| 缓存/模板/异步 Worker | Redis、BullMQ、受控 Recipe、报告后台恢复、原 execution-worker | 普通需求处理的持久化、缓存失效、作业级预算和时效指标 | 扩现有设施，不新建副作用执行后端 |

产品定义已经明确 Personal Life OS：[PRODUCT.md:3](PRODUCT.md#L3)。当前链路和禁止平行 Engine 的边界见 [ARCHITECTURE.md:3](ARCHITECTURE.md#L3)。因此，“当前只有用户→聊天→回答”能说明体验感受，不能作为现有后端能力的准确清单。

## 3. 优先发现

这里的优先级指后续实现顺序。静态确认、恢复风险和真实验收缺口分别表达。

### P1：报告生成状态与日程完成状态矛盾

初始 QUEUED 报告保存为 result=ANSWER：[consumer.service.ts:190](../../apps/api/src/consumer/consumer.service.ts#L190)。日程只根据 result 做投影：[consumer.service.ts:346](../../apps/api/src/consumer/consumer.service.ts#L346)。ANSWER 一律映射“已生成答复 / COMPLETED”：[projection-policy.ts:6](../../apps/api/src/consumer/projection-policy.ts#L6)。WorkItem 也直接映射 ANSWER_AVAILABLE：[work-item-projection.service.ts:47](../../apps/api/src/consumer/work-item-projection.service.ts#L47)。

所以报告仍在生成或已失败时，日程能够显示已完成。这是静态路径可确认的产品缺陷；本轮未做真机重现。

V91 首批应修正：QUEUED/PLANNING/RESEARCHING/WRITING/REVIEWING 为处理中，FAILED 为失败，SUPERSEDED 为被新需求替代，COMPLETED 仅表示报告生成完成。报告内容中的市场判断是否得到现实核实，是另一个维度。

### P1：普通会话需求处理缺少明确崩溃恢复

[consumer.service.ts:179](../../apps/api/src/consumer/consumer.service.ts#L179) 先持久化用户消息和 PROCESSING，再同步等待 Planner 模型（203），最后恢复 ACTIVE（205）。关键源码检查未找到该 PROCESSING 状态对应的租约或恢复工作。

API 在前一事务完成后退出，存在会话留在 PROCESSING、后续请求被拒绝的风险。本轮未杀进程验证，不能标为实际故障已复现。

应把需求解析/方案生成持久化为 authoring job：请求身份、会话版本、阶段、租约、超时、取消、恢复和幂等发布。报告已有恢复队列，可复用其思路；工具副作用仍由原 Execution Runtime 处理。

### P1：权威下一步投影未进入移动端主界面

已有 [WorkItemProjectionService:14](../../apps/api/src/consumer/work-item-projection.service.ts#L14) 聚合计划评估、审批、执行、核对、草案、提醒和会话，并保留证据、评估时点、失败和截断标识。接口见 [consumer.controller.ts:33](../../apps/api/src/consumer/consumer.controller.ts#L33)。

生产 Mobile 没有使用 consumer/work-items 或 nextBestAction。日程分别读取 timeline、attention、notifications，再按中文状态正则分组：[schedule.tsx:21](../../apps/mobile/app/(tabs)/schedule.tsx#L21)、[schedule-projection.ts:10](../../apps/mobile/src/schedule-projection.ts#L10)。新 Projection 模块应先收敛并接入这些已有能力，避免后台又增加一个无人消费的投影。

### P1：目标理解有解释卡，缺完整需求合同

[goal-understanding.ts:3](../../packages/plan-schema/src/goal-understanding.ts#L3) 是只读 AI_PROPOSED 解释，不是稳定 Goal Model。[scenario-contract-v2.ts:17](../../packages/plan-schema/src/scenario-contract-v2.ts#L17) 只提供 intent、description、基本值 constraints。

预算、地点、时间、成功标准、动机及风险偏好需要结构化，同时明确它们是用户声明、用户确认、系统假设还是未知。不能把模型举例的“10 万元预算”自动写成用户事实。

### P1：方法组合尚不足以支撑方案中的自动服务组合

[skill-repositories.service.ts:133](../../apps/api/src/portable-skills/skill-repositories.service.ts#L133) 从最新 60 条中按领域/名称/整段描述匹配，最多取 3 条；[skill-capability.ts:38](../../packages/plan-schema/src/skill-capability.ts#L38) 的方法引用也最多 3 条。用户创业示例的 4 个方法不能直接套现有合同。

方法 input/output 目前是任意 JSON 声明：[skill-capability.ts:9](../../packages/plan-schema/src/skill-capability.ts#L9)。当前 Planner 仍以注册 Scenario/Strategy 和受控 Recipe 编译为主：[agent-planner.service.ts:348](../../apps/api/src/ai-adapter/agent-planner.service.ts#L348)。现 TaskGraph 由合法 Execution 的已冻结步骤顺序生成：[task-runtime.ts:10](../../apps/api/src/agent/tasks/task-runtime.ts#L10)。这些不是任意多方法依赖图已经实现的证据。

先提供有界、可检查的顺序组合和字段映射，验证成功后再扩并行研究。不要仅放宽数组上限就宣称“自动调度 Skill”。

### P1：持续计划需明确错过触发时间的语义

[github-digest-schedule.service.ts:24](../../apps/api/src/execution/github-digest-schedule.service.ts#L24) 固定 09:00/上海时区，超过当前时槽 60 秒就跳过（26）。该实现如实保留漏跑，不补造记录，但主机在这一分钟不可用可能漏掉当天汇总。

后续应在原调度链提供持久化 occurrence 身份，以及显式 misfirePolicy：跳过、补最近一次、有限补发。读取当前日榜的补发必须标记实际读取时间，不能冒充昨日榜单。外部写入是否能补发仍由原风险和幂等规则决定。

### P2：方法内容身份和版本语义不统一

[skill-descriptor.ts:135](../../apps/api/src/portable-skills/skill-descriptor.ts#L135) 的官方方法 hash 只覆盖 name@version 和 Markdown 正文，没有覆盖输入、前置条件、允许能力/工具及 outputContract 等 frontmatter。

[skill-registry.service.ts:23](../../apps/api/src/portable-skills/skill-registry.service.ts#L23) 按 name 存储并拒绝不同版本，不能用于市场多版本并存。导入方法已有不可变 Revision，应统一完整描述的规范化 hash 和版本语义。这里是版本身份风险，不是已证明可绕审批。

### P2：报告交付和 PC 仍有明显产品缺口

[report.tsx:14](../../apps/mobile/app/report.tsx#L14) 通过读取整段会话提取报告；正文作为普通 Text 渲染（22），缺少真正的 Markdown 表格、图表、方案比较和独立交付物目录。

[apps/admin/app/page.tsx:75](../../apps/admin/app/page.tsx#L75) 是只读运维 Dashboard。Mobile Web export 能运行 Web 页面，不能证明用户 Workspace 已存在。报告目标应先获得最小 PC 阅读工作台，完整管理中心再扩展。

### 发布与真实验收：不能由 V91 名称升级关闭

本轮静态迁移安全门再次拒绝缺少发布证据的 0083_runtime_authority_sources.sql；没有执行迁移。历史依赖审计记录仍有 8 项问题，其中 5 high、2 critical：[V88_REPORT_WEB_RESEARCH.md:21](V88_REPORT_WEB_RESEARCH.md#L21)。本轮网络受限，未刷新依赖审计，不把历史数量作为最新扫描结果。

CI 有类型、测试、MySQL8.4、备份恢复和 Android 门。但完整 RC/Android 的 PR 分支条件仍专门识别 codex/v83：[ci.yml](../../.github/workflows/ci.yml)。后续 V91 分支的 CI 范围应核对并显式更新；本轮未查询 GitHub 运行状态，不能声称远程 Green。

## 4. 推荐架构：统一编排，保留现有权威

~~~mermaid
flowchart TD
    U[用户目标] --> X[手机与 PC 体验层]
    X --> G[版本化需求 GoalBrief]
    G --> O[现有 Agent 编排]
    O --> M[方法发现与组合]
    O --> C[原 Capability Resolver]
    M --> D[交付定义与受控编译]
    C --> D
    D --> A[现有确认 风险 审批]
    A --> B{原生命周期分流}
    B --> T[临时计算或合法一次性操作]
    B --> E[内部个人事项]
    B --> P[持续 Plan 与冻结版本]
    P --> R[原 Invocation Shared Runtime]
    T --> V[结果检查与适用的 Verification]
    E --> Q[事项生命周期与提醒]
    R --> V
    V --> F[Result Evidence 交付物]
    V --> H[原 Truth Authority 按政策发布]
    F --> Z[统一体验投影]
    H --> Z
    Q --> Z
    Z --> X
    F --> L[经验候选与受控评估]
    L --> K[已有 Memory 或新方法 Revision]
    K --> O
~~~

此图表达职责，不替代原协议的实际事务顺序。不是所有计算都需要执行审批，不是所有结果都写 Truth，内部提醒不强制创建外部 Invocation；外部副作用必须经过现有权威。

Orchestrator 负责装配上下文、决定需求分支、解释方法选择、提出能力需求、调用现编译/创建入口、跟踪结果。它不直接执行第三方工具、不批准自身、不生成可信事实、不重新实现调度或重试。

先保留模块化单体、已有 API/execution-worker/outbox-worker。新增文件夹只是组织方式；没有性能、隔离或团队边界证据时，不把六个逻辑职责拆成六个微服务。

## 5. 四类合同必须分清

### GoalBrief：表达需求和成功标准

建议包含 schemaVersion/revision、目标说明、动机、现状、资源、限制、预算、地点、时区/期限、成功标准、风险偏好、未知项、假设、字段来源和关联对象。

每个关键字段保留 value/status/sourceRef/updatedAt。风险偏好影响方案排序，不降低实际动作的 Risk/Approval。需求澄清优先问会改变方案或风险的缺项；其余可用明确假设先交付草稿。补充信息必须更新需求版本并标记旧产物适用性，不能静默覆盖。

现有 [CreationDraft goalJson:1194](../../packages/database/src/schema.ts#L1194) 和 [PlanCreationContract goalJson:1170](../../packages/database/src/schema.ts#L1170) 可承载第一阶段。确认后沿 [freezeConversationSources:201](../../apps/api/src/creation-drafts/creation-drafts.service.ts#L201) 冻结进按 PlanVersion 绑定的创建合同。现 ScenarioGoalSpec 是 strict schema，扩展须有版本兼容；不能任意塞入未校验 JSON。

PlanVersion 本表没有 goalSnapshot 字段。未来一个复杂目标跨多个 Plan 时，可以新增只负责目标关系、里程碑和成果索引的 GoalWorkspace；持续执行权限继续由 Plan 掌握。

### Skill：版本化方法，不是执行授权

沿 Repository → Entry → Immutable Revision → 冻结引用。增强输入输出 schema、适用条件、必要事实、能力需求、字段映射、结果检查和失败行为。只支持明确白名单内的 schema/组合规则；仓库文件、网页、提示词始终作为非可信材料。

方法选择先过滤契约兼容、所需资源、版本有效性和适用条件，再排序。理由应可展示。没有适用 Skill 时可以用原直达能力或显示缺口；简单 USER_EVENT 可以使用 0 个 Skill。

版本评分来自有验收口径的真实样本，并附样本量、时间和不确定性。冷启动使用适用性标签，不能由模型制造 95 分质量。风险不能由方法自报分值覆盖原动作风险。

### Resource：具体能力绑定

应分为 CapabilityDefinition（能做什么）、ResourceBinding/Connection（哪个设备/账号/范围提供）、Grant/Credential/Health（当前状态）、Invocation（本次调用）。Connector/ProviderAdapter 是实现，不等于用户资产，也不等于权限。

现有目录 usability 允许 BETA：[capability-manifest.ts:126](../../packages/connector-sdk/src/capability-manifest.ts#L126)；具体 Resolver 只允许 PRODUCTION，且核对字段、用途、账号、时效和成本：[capability-resolver.ts:52](../../packages/connector-sdk/src/capability-resolver.ts#L52)。展示必须区分“目录中已有”“已连接”“待授权”“本目标可用”“本次已获执行授权”。

微信/支付宝还有候选骨架：[provider-registry.ts:6](../../packages/connector-sdk/src/provider-registry.ts#L6)。资源页可以说明待接入的能力，不能把发送消息或全量账单展示为现已实现。

### Service/DeliverySpec：承诺什么成果

“多个 Skill 相加”只说明内部方法，没有定义服务交付。建议增量增加版本化交付定义：适用目标、输入、方法引用、依赖、成果 schema、验收标准、预算/时效、风险与人工决策点。

交付实例关联 GoalBrief revision、PlanVersion 或合法计算 job、Execution、Artifact/Result，不拥有第二套执行状态机。现实 ServiceOffering/ServiceRequest 继续用于供给与履约，可以成为组合中的人工步骤。

第一阶段可把“创业分析助手”呈现为一个由上述定义驱动的能力卡。不要为这张卡新建 ServiceWorkflowEngine；也不要只换现有商品卡标题。

## 6. 交付物与证据设计

报告、摘要、对比表、计划和决策记录应可独立找回，并绑定需求/方法版本。已有文档 artifact 和报告来源可复用；是否新建生成产物表，取决于索引、历史版本和大小需求，不为命名直接新增存储系统。

最小交付物描述建议有：类型、状态、需求版本、方法版本、内容/hash、结构化章节或数据、来源引用、假设、计算模型版本、质量检查、适用限制、创建/更新时间和分享操作。

至少分清四类状态：

| 维度 | 示例 | 不能推出的结论 |
| --- | --- | --- |
| 工作状态 | 生成中、已生成、失败、已被替代 | 已生成不代表现实目标完成 |
| 来源等级 | 用户上传、公开来源响应、模型假设、程序计算、原权威核实 | 官方网页响应不自动核实租金/客流 |
| 交付检查 | 章节完整、引用可定位、计算一致、限制披露 | 模型自检不等于独立市场验证 |
| 目标验收 | 用户批准进入下一阶段、某成功条件达到 | 某一次运行成功不等于长期目标达成 |

V94 应把报告升级为证据驱动的决策产物：结论、备选方案、成本/收益、敏感性、风险、待核实项、下一步。金额、利润、产能等由受控程序计算；关键参数引用来源或明确假设。评分必须给指标、权重和缺失数据，不用精确分数掩盖不确定性。

源材料需足以支持实际结论。网页数量和文章长度不等于相关性；荆门营商背景不能替代当地店租、竞争店、客流和排水要求核实。可交付假设稿，但必须保持假设稿身份。

## 7. 用户体验与多端

既有五导航基线为日程｜计划｜会话｜资源｜服务：[PRODUCT.md:20](PRODUCT.md#L20)。本方案的新首页、问一问和 Skill 一级页会改变该基线，这是产品决策，不能作为新增模块的附带结果。推荐先沿五入口升级：

- 日程：今天、持续目标摘要、需要本人处理、最新交付物和下次检查。
- 计划：目标、业务阶段、已达标准、待补材料、下一步、成果；方法中心放在其二级区域。
- 会话：输入“想完成什么”，显示理解和必要澄清，完成后回到同一目标或结果。
- 资源：按设备/账号/资料及用途表达，逐项能力、范围和状态保持真实。
- 服务：现实服务与有交付合同的数字能力可分区展示，目录可见性与当前可用性分开。

UI 不要求用户理解 Task/Runtime/Execution 等内部词，但“来源不足”“等待授权”“等待本人判断”“结果尚未核实”等信息直接影响决策，应保留。

目标进度来自可验收里程碑。没有合理分母时显示“已完成 2 项核实 / 尚缺 3 项”，而不是模型猜 40%。持续监控类计划显示最近检查、覆盖情况、下次检查和异常，不显示最终完成百分比。

PC 可使用独立用户 Web 应用或共享 Web 表面；与 Admin 隔离。先交付报告阅读、目标编辑、资源补齐和审批跟进，再扩完整三栏工作台。手机审批后 PC 按同一版本刷新；PC 编辑改变版本时手机旧方案须失效。PC 不持有设备系统权限，也不成为新的执行后端。

## 8. 性能、后台工作与 API

用户 API/内部 API 的区分应由认证身份、RBAC、网络暴露和服务职责保证，不能仅靠 /api 与 /internal 路径。Consumer/BFF 可以新增稳定用户读模型；合法命令仍调用原创建、确认、审批和执行服务。不要为了新命名复制 plans/resources/skills 的第二套 CRUD。

普通需求提交先持久化请求和 job，再尽快返回可跟踪身份。计算 job 可进入原 worker 的独立队列；文档生成与外部副作用的权威不同，不能把两个队列都称为“执行成功”。

缓存用户摘要、方法目录和只读投影，以 owner、需求/计划/方法版本及授权变更版本隔离。资源状态同时返回 observedAt/stale/reasons。缓存不能授予执行权；调用前仍重新核对实际版本、范围、权限、健康和证据。

模板沿原 Recipe/DeliverySpec 复用，只冻结结构与方法版本。用户事实、价格、资源状态和执行授权不能随模板缓存。先以确定模板完成一个业务场景，再逐步支持模型调整和通用组合。

每个 job 应有总 token/费用、墙钟时间、检索页数、单页大小、并发、重试上限和停止规则。单次模型调用 90 秒超时不代表整个报告耗时或成本受控。跨用户队列应考虑公平性，避免一个大型目标占满计算资源。

建议测量：持久化受理延迟、首个有意义阶段反馈、完整交付耗时、等待用户的次数、失败恢复时间、资源恢复后续行成功率。对“立即看到”“预计两分钟”先定义测量口径；没有实际分布前只显示阶段，不承诺固定两分钟。

状态刷新先共用稳定轮询/ETag；需要更低延迟时增量接 SSE/事件投影。复用已有 outbox 和审计，不新增事件权威或另做全量 event sourcing 重构。

## 9. Verification → Learning

现有 [MemoryService:17](../../apps/api/src/memory/memory.service.ts#L17) 已默认关闭，支持保存、引用、删除和撤回复核；现 [Loop Reflection:18](../../apps/api/src/agent/loop/agent-loop-reflection.ts#L18) 根据确切结果证据给出只读核实结论。V96 需要连接它们，而不是再建一套 Memory 数据库。

建议区分：用户资料/偏好、现实 Truth、执行记录、决策记录、经验候选、方法质量统计。经验候选记录适用情境、输入约束、原执行/结果/evidence refs、结果、不确定性、时间和过期条件。

个人偏好或长期资料沿既有候选确认；关闭或删除后不再进入规划上下文。方法改进形成新 Revision，经过评估才能被下一次选择。运行中的 PlanVersion 不被学习过程改写。UNKNOWN 结果只形成“待核对”的记录，不能学习成成功。

可以用已验证操作统计调整方法推荐，并保留版本级样本和理由；不能自动降低风险策略、扩大授权范围或发布新的自动写入动作。先证明一个经验候选被合法接受、在下一次同类规划中被消费，再谈通用自我优化。

## 10. 建议修订的 V91–V96 路线

保留用户版本编号，但每阶段交付完整用户切片；Memory 和资源基础从 V91 就复用，PC 最小报告阅读可在 V94 提前出现。下表为建议路线，本轮没有启动实施，也没有改变 V84–V90 的真实验收状态。

| 版本 | 主交付 | Backend / Runtime | Frontend | 关闭证据 |
| --- | --- | --- | --- | --- |
| V91 目标闭环基础 | 同一目标可解释、可找回、可恢复 | GoalBrief 版本兼容；持久化 authoring job；统一 outcome/WorkItem 投影；原权限不变 | 日程目标摘要、需求卡、真实下一步；修正报告完成状态 | 正常入口→需求→方案/报告→离开页面→找回；中断恢复与旧版本拒绝；所有页面状态一致 |
| V92 方法组合交付 | 一个真实多方法目标完成交付 | 统一 Revision/hash；可检查输入输出；适用性选择；有界组合编译 | 能力目录、选择理由、所需材料、方法来源 | 实际第三方方法与实际资源组合；更新不改变旧版本；无适用方法可恢复 |
| V93 持续运行与资源可靠性 | 一个目标稳定每天运行 | 目标级资源 eligibility；权限撤回；schedule occurrence/misfire；原 worker 恢复 | 授权/修复返回原目标；实际运行、漏跑、等待可见 | GitHub 首次真实运行及真实七日记录；停机/恢复、暂停、撤权、去重有独立证据 |
| V94 决策报告 | 一份可用于决策的结构化交付 | 复用 Report job；Artifact 版本；来源充分性；程序模型/敏感性/质量检查 | Mobile 阅读/比较/分享；最小 PC 报告工作台 | 荆门洗车店场景真实授权资料、假设、计算、结论、待核实及下一步；质量不通过保持失败 |
| V95 个人 Workspace | 手机与 PC 操作同一目标 | 共享 Consumer/BFF；命令版本校验；owner 隔离；原审批执行链 | 目标/计划/资源/成果工作空间，手机确认与 PC 同步 | PC 编辑→手机审阅→原 Runtime→PC/手机相同结果；版本冲突和资源断开可恢复 |
| V96 受控学习与 OS 联合验收 | 结果改善下一次决策 | 经验候选、决策记录、方法版本评估；已有 Memory 删除/关闭生效 | 使用依据、接受/拒绝/撤回经验；历史决策与成果 | 一个已验证经验在下一次规划消费；UNKNOWN 不污染记忆；联合真实闭环与发布门通过 |

公开 Marketplace、支付、创作者评级与大规模多领域能力扩张，应等版本/兼容性/交付质量证明稳定后再商业化。分类可以先做；“有分类”不等于生态已完成。

## 11. 两条优先验收旅程

### 荆门洗车店：交付与决策

复用本人已确认的“荆门城区、租赁、2–3 工位人工洗车+基础美容”假设。先把需求和来源身份保留到目标；明确本次成功标准是“产出可审阅的商业评估”，不能把它等同于“成功开店”。

App 自主生成提示词和研究计划，解析已授权资源，读取相关资料，程序计算多情景，形成结构化报告，显示待核实项和选址/预算下一步。用户离开会话后仍能在日程、计划/目标和 PC 找回同一交付物。用户补预算后生成新版本，旧版保留假设与适用限制。

历史已完成的真实自主报告和荆门官网原文子闭环可复用为基线：[V88_AUTONOMOUS_REPORT.md](V88_AUTONOMOUS_REPORT.md)、[V88_REPORT_WEB_RESEARCH.md](V88_REPORT_WEB_RESEARCH.md)。它们尚不足以证明通用创业 Service 或当地市场参数已核实。

### GitHub 每日榜：持续性与恢复

复用本人已审阅的日榜前 10、所有语言、北京时间 09:00 和已授予的 GitHub 网站范围，不重复索取已完成的审阅/授权。原 App 草稿启动、首次生成和真实七日仍按实际证据核验。

每次分别显示：计划启用、榜单读取、模型摘要、站内通知、系统通知送达/查看。已生成站内通知不能声称 Android OS push 已送达。比较基线取上次成功，失败和漏跑保持历史；恢复后读取今天榜单不能标成昨日运行。

目前记录确认原计划仍 draft、无首次 Execution；手机断开后验收暂停：[V88_GITHUB_DAILY_DIGEST.md](V88_GITHUB_DAILY_DIGEST.md)。本轮未重新连接设备或查询个人运行状态。

## 12. 本轮检查与证据

### 本轮实际验证

| 检查 | 本轮结果 | 本机日志 |
| --- | --- | --- |
| 全仓 TypeScript | 8/8 包通过，直接调用已安装本地 tsc | artifacts/v91-review-typecheck-*.log |
| Mobile | 67 文件，419/419 通过 | artifacts/v91-review-tests-apps-mobile.log |
| Plan Schema | 49 文件，264/264 通过 | artifacts/v91-review-tests-packages-plan-schema.log |
| Config | 5 文件，63/63 通过 | artifacts/v91-review-tests-packages-config.log |
| Shared | 2 文件，7/7 通过 | artifacts/v91-review-tests-packages-shared.log |
| Connector SDK | 首轮 58/59；失败项为沙箱回环 TCP EACCES；允许 localhost 后相关文件 19/19 通过 | artifacts/v91-review-tests-packages-connector-sdk.log；v91-review-connector-sdk-loopback-enabled.log |
| API 报告/GitHub/Reflection 纯单测 | 4 文件，30/30 通过 | artifacts/v91-review-api-unit.log |
| API 需求理解/原执行 handoff 纯单测 | 2 文件，8/8 通过；与上一行文件不重叠 | 本轮后端专项输出 |
| Repository hygiene | 3127 个 tracked 文件检查通过 | 本轮工具输出 |
| Current terminology | 974 个现行文件检查通过（报告新增前） | 本轮工具输出 |
| Production data truth | 通过 | 本轮工具输出 |
| Drizzle segmentation | 91 个迁移文件检查通过 | 本轮工具输出 |
| Migration safety | 未通过：0083 缺少 staging/production 发布证据 | 本轮工具输出；没有执行 SQL |

首轮 pnpm 命令因 Corepack 试图下载而被网络限制阻断，没有进入类型检查；之后使用本地工具完成。SDK 首轮失败和回环探测保留，不删除环境失败记录，不把重复复跑的 19 项累加为新增覆盖。

本轮测试使用现有本地依赖/构建产物；未重新执行整个 monorepo build 或包含数据库写入的 API 全套集成。当前工作区含 12 个用户独立修改，因此结果描述当前工作区，而不是仅已推送提交或已安装 APK。

### 真实证据边界

- 已有历史真实证据：计算器 Observe→本人核实→Truth；原会话自主报告及有限官网原文研究。依据专项文档，不称本轮重验。
- 仍待验：当前 GitHub 原 App 启动/首次生成/真实七日，V87 外部 Act/read-back，V89 实际第三方组合，V90 联合验收和发布门。
- 未刷新：远程 CI、最新依赖漏洞审计、真实数据库并发/备份恢复、当前三角色就绪/手机状态、端到端延迟和容量。

### 本轮交付状态

Backend：完成源码与权威链评审；未修改实现。

Frontend：完成 Mobile/PC/投影评审；未修改实现。

Database：完成现有 Goal/Skill/Service/Memory 承载与静态迁移门检查；零 SQL/迁移操作。

Runtime：完成 Task、异步报告、持续调度与恢复边界评审；未启动或改变个人计划。

Test：上述类型/测试/静态检查已执行，环境失败与发布证据缺口保留。

完成状态：评审完成；用户原有 12 个独立文件保留；仅新增本评审文档和本机检查日志，没有提交、推送或发布。

建议下一任务：V91-01 统一目标与结果合同，首批解决报告状态、普通需求持久化恢复、WorkItem 主界面接入。需求版本、交付状态、执行状态、事实等级和目标成功标准同时定义，再沿原权限与 Runtime 完成首条真实用户闭环。
