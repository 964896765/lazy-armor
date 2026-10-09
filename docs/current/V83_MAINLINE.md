# V8.3 P0～P11 前后端一体化总计划（2026-10-09）

依据用户2026-10-09最新总计划，本文件统一后端能力、移动端产品表面和真实验收。P0 Phase 1 CLOSED、P1/P2 CLOSED、P3 IN_PROGRESS；P4～P11是后续范围，不代表已实现。历史实现、迁移、PlanVersion与真实Evidence保留。下方带时点的checkpoint只记录当时事实，不覆盖当前状态。

## 产品与权威

统一母结构：User → Conversation / Goal → GoalExecutionContext → Planner/Router判断TEMPORARY / USER_EVENT / PERSISTENT → 按需组合0～N Skill → Facts / Capability Requirements → Resolver（Resource / Service）→ 缺能力时ResourceGap → Risk / Approval → CapabilityInvocation → Shared Durable Runtime → RuntimeTarget → Result / Ledger → Verification / Reconciliation → Truth → Result / Assessment / Replan / WAIT。

此链描述目标产品流程，不改变现有 canonical Invocation、Risk/Approval、Connection、RuntimeTarget、Truth Authority 的执行合同。Skill 与 AI 只提出受控方案；不能自授权限、声明 Truth 或绕过确认。持久需求继续通过 CreationDraft、用户确认和合法 PlanVersion 冻结。未实现 Skill 平台时不制造虚构 SkillEntryRevision/PlanSkillReference 来冒充新主链完成。

GoalExecutionContext是只读派生上下文，不拥有Authority。生命周期与执行复杂度分开；简单内部USER_EVENT不被强迫变成Plan或外部Invocation。上述母结构也不改写各协议实际Verification/Ledger/Truth提交顺序。

新能力只能通过既有Manifest / Capability / Resolver / Invocation / Runtime / Verification / Truth接入。Android、Provider、MCP、Windows、Cloud、Service是Target类型，不是新的核心Engine。不得另造SkillEngine、McpExecutionEngine、ServiceWorkflowEngine、ScenarioEngine、WindowsEngine或AgentEngine；现有Plan与USER_EVENT_SYNC共享执行来源及恢复合同继续复用，不能因接入新Target再建一套Plan/Runtime。

## 五个一级页面永久冻结

正式顺序为：**日程 | 计划 | 会话 | 资源 | 服务**。永久冻结名称、数量、顺序与职责；不新增首页、问一问、Skill、Agent、MCP、Runtime、Todo或Automation一级入口。

| 页面 | 正式职责 | 核心对象与归属 |
| --- | --- | --- |
| 日程 | 现在、今天、接下来有什么与用户有关 | USER_EVENT、Plan next run、Approval、Attention、Service、Result；按授权取得的外部Calendar Truth仍是投影来源 |
| 计划 | 哪些长期目标正在持续处理，有哪些可用方法 | 我的计划、Skill仓库；仓库是方法来源，计划是已确认长期目标 |
| 会话 | 用户现在想让系统做什么 | Goal、Temporary、USER_EVENT、Plan authoring与结果 |
| 资源 | 系统现在真正能读取和操作什么 | 本机、云端、其它设备、接口及其Capability/授权/健康 |
| 服务 | 哪些现实服务能替用户完成事情 | ServiceProvider、ServiceOffering、ServiceRequest及履约状态 |

二三级页面、信息结构、状态表达、组件、视觉、交互、空/错误状态和恢复路径不冻结，随P4～P11同步精细化。方法仓库不进入资源列表，MCP归接口，Windows归其它设备，Cloud能力归资源，现实履约仍归服务。

日程采用 Plan 权威 + 既有 ScheduleProjection + Internal Event Authority；外部日历仅为资源。详见 SCHEDULE_AUTHORITY.md。

## 每阶段三轨同步

| 轨道 | 同一阶段要完成的工作 |
| --- | --- |
| Backend Capability | Authority、Contract、Resolver、Runtime、Truth、API/只读Projection |
| Product Surface | 页面归属、信息层级、用户状态、操作入口、错误/恢复、视觉与交互一致性 |
| Real Evidence | 前后端真实联调、真实设备/账号/服务、现实验证、恢复证据与真机UX检查 |

阶段关闭须同时满足Contract DoD、Runtime DoD、Product DoD、Real Evidence DoD。自动回归与构建是必要验证，不能独自宣布CLOSED。该规则用于后续阶段收口，不回溯追加P1/P2关闭条件或扩大已冻结P3矩阵。

## 阶段与当前状态

| 阶段 | 名称 | 范围与完成标准 | 当前状态 |
| --- | --- | --- | --- |
| P0 | Product Authority Cleanup | 新 authoring 不强迫选择 Domain/Scenario/Template；退出旧策略用户入口；分类可扩展；旧资产兼容，建立迁移清单 | Phase 1 CLOSED；正式迁资产留 P6 |
| P1 | Persistent Plan Reliability | 定时 Observe/Assess/Resolve/Act/Verify/Replan/NEXT WAIT；可靠交付与故障恢复 | CLOSED：既定真实 fault matrix 已收口，Calendar reliability 冻结 |
| P2 | USER_EVENT + Multi-Authority Runtime | 内部生命周期、提醒/时区/投影；显式外部create/update/delete、版本隔离与受控Runtime恢复/幂等 | CLOSED / REAL_VERIFIED；32项真实关闭复核，站内提醒边界不含OS push |
| P3 | ResourceGap Automatic Resume | 缺资源 → 授权/连接 → 原 Goal 保存 → Resolver 重算 → 原 Action/Plan 继续 | IN_PROGRESS；最终复核57/57，历史空读WAIT与旧sourceVersion/epoch holder拒绝已验；r5安装快照WAITING_RESOURCE，r6正常恢复后真实空读WAIT；Shipment Truth、正向Truth发布一致性及Plan Truth Assessment仍REAL_PENDING |
| P4 | Plan Detail / 计划体验优化 | 解释目标、当前进展、下一步、最近发现、待处理、历史、方法与资源，隐藏主表面的Runtime技术对象 | 后续；既有主体冻结，本次仅准备设计 |
| P5 | Service Runtime | Invocation → ServiceRequest → WAITING_EXTERNAL → 履约 → Reality Verification → Truth/Replan | 待真实 Golden Flow |
| P6 | Skill 仓库 / 方法与资源组合 / Legacy Migration | SkillRepository / SkillEntry / 不可变 SkillEntryRevision / PlanSkillReference；0～N方法组合真实资源，迁移旧资产 | 后续；设计准备，未宣称实现 |
| P7 | Provider / MCP Multi-Target | P7-A 真实 Provider read/write；P7-B canonical MCP read-only；P7-C selection/fallback | 待真实证据 |
| P8 | Android UI Agent / AppSkill | 首批 1–2 个真实 App；Observe/Find/Policy/单步 Act/Observe/Verify | 待闭环 |
| P9 | Windows Runtime Node | heartbeat/manifest/file/clipboard/browser.open/notification/artifact；写入 sandbox；真实跨设备 Plan | 未完成 |
| P10 | Cloud Workspace / Capability Synthesis | 隔离 FS/browser/HTTP/code sandbox/credential broker/lease；Candidate → 验证 → manifest → Registry → Invocation | 未完成 |
| P11 | Cross-Target Final Closure | 全 Golden Flow、故障矩阵、Evidence、回归、CI、安全/性能、Repo Hygiene、Beta Gate | 未达到 |

2026-10-09 用户最新主线固定为：P1 Persistent Plan Runtime=CLOSED；P2 USER_EVENT + Multi Authority Runtime=CLOSED；P3 ResourceGap Auto Resume=IN_PROGRESS；P4 Plan Detail / 计划体验优化、P5 Service Runtime、P6 Skill 仓库均为后续。此口径替代先前“P3后提前开发Skill组合”的安排，不重编号或把Skill实现合并进P3。

等待真实京东物流数据期间只准备后续设计，不开发。P4设计见 [P4_PLAN_EXPERIENCE_DESIGN.md](P4_PLAN_EXPERIENCE_DESIGN.md)，P6方法组合设计见 [P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)。既有Plan详情主体与SkillRepository/Entry/Revision基线保留，未实现功能不宣称完成；Skill按需组合0～N个方法，授权、执行与Truth仍由独立权威控制。

## P0～P3 已有范围与当前边界

P0 Phase 1 CLOSED，后续只做非阻塞兼容清理，不重新打开主阶段。Legacy Domain/Scenario/Template/Strategy逐步降为tag、category、useCase、evalCase、compatibility metadata或deprecated asset；新业务不得要求用户先选领域/场景/模板才能创建Plan。前端去掉旧固定向导、策略选择和模板创建主入口，历史引用与合法运行合同保留。

P1 Persistent Plan Reliability CLOSED / REAL_VERIFIED，不再扩Calendar开发或故障矩阵。长期Plan的Observe/Assess/Approval/Invocation/Verification/Reconciliation/Replan/WAIT，以及既定lease/ACK/unknown/stale/duplicate恢复证据冻结。后续只能复用其权威，前端表达优化不改变模型。

P2 USER_EVENT + Multi-Authority Runtime CLOSED / REAL_VERIFIED。默认“明天下午3点提醒我”创建内部USER_EVENT，不创建Plan或手机日历；显式外部同步进入已验证Shared Runtime。日程聚合事项、计划时间、待处理、服务状态和结果。Android OS Push可在后续作为独立Capability完善，不重开P2核心架构，当前不宣称已验收。

P3的目的是真实证明缺能力时保存目标、资源补齐后自动恢复、获取事实、判断与行动，再继续等待。当前Temporary与Persistent空读恢复、健康门、sourceVersion/epoch fencing、历史保留和重启恢复已真实验收；仅剩Shipment Candidate→用户核实→Truth、Truth发布一致性、真实异常Truth→Assessment→站内提醒→post-result WAIT三项。普通物流通知不能替代异常提醒证据。三项齐全后直接CLOSED并冻结京东通知可靠性线；不追加SMS、MCP、Provider、Windows或其它ResourceGap类型。完整范围见 [P3_RESOURCE_GAP.md](P3_RESOURCE_GAP.md)。

## P4～P11 前后端一体化范围

### P4 — Plan Experience / Human Semantics

P3关闭后的第一个正式同步阶段。后端复用/完善只读Plan Experience Projection，将现有Plan、PlanVersion、Truth、ResourceGap、Assessment、Approval、Result与Runtime状态映射成当前目标、进展、下一步、最近发现、需处理、最近检查与历史结果；不增加Plan Engine或新Authority。

移动端同步精细化计划列表/详情，日程与会话承接ResourceGap、Candidate待核实、Approval、Truth结果和核对状态；覆盖暂停/恢复/结束、历史及版本。主页面不直接展示Invocation、Ledger、epoch、Worker或lease。空读不能显示“无异常/没有快递”，最近检查不能用心跳代替。

P4 DoD至少真机覆盖：运行中、WAITING_RESOURCE、VERIFIED_EMPTY、Candidate待核实、Truth有效、Approval待处理、结果核对中、暂停、结束。每个页面状态和可用操作都与当前Authority一致；设计/fixture不替代真实UX证据。细则见 [P4设计](P4_PLAN_EXPERIENCE_DESIGN.md)。

### P5 — Service Runtime

后端沿用已有服务对象并补齐ServiceProvider、ServiceOffering、ServiceCapability、ServiceRequest、ServiceStatus、ServiceEvidence合同；通过既有Resolver→Risk/Approval→Invocation→Shared Runtime→Verification→Truth接入。服务请求进入WAITING_EXTERNAL，服务方接受/拒绝/完成是履约状态，需真实证据验证后才形成Truth并恢复原Goal/Plan。

第一条服务选择低风险、可取消、容易回读的真实供给，第一版不自动付款。服务页完成发现、详情、服务商/能力、请求、确认、进行中、接受/拒绝/完成/取消和问题处理；日程呈现预约/待履约，计划关联长期服务目标，会话自然语言发起请求。

P5 DoD：真实发现→请求→确认→服务方状态变化→Verification→Truth→原Goal/Plan继续。不得以请求提交成功或服务方单句“完成”代替现实履约验证。

### P6 — Skill仓库 + Skill / Resource Composition

正式实现SkillRepository→SkillEntry→Immutable SkillEntryRevision，支持Official、GitHub、URL、Upload、Community和User-created来源，按既有V1/V2/V3基线分步推进。Planner按Goal检索0～N方法、Rank/Compose、生成Facts/Capability Requirements再进入Resolver。PlanVersion冻结方法版本引用，仓库更新不得暗改运行中Plan。

首条真实Skill优先Shipment Intelligence，复用P3的通知→Candidate→用户核实→Truth→Assessment；不另造物流事实或执行体系。计划页保留Skill仓库/我的计划，完善仓库、方法搜索/详情、来源/版本、所需信息与能力、限制、用于当前需求、开始会话和Plan方法引用。会话解释采用的方法与资源需求，资源页只展示真实Resource。

P6 DoD包括真实检索/组合、当前资源解析、合法确认和冻结引用、既有Runtime执行、Candidate/Truth与结果归属，以及方法更新不修改旧Plan。点击Entry不直接创建Plan，Skill不获执行/Truth权。详见 [仓库基线](SKILL_REPOSITORY_DESIGN.md) 与 [组合设计](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)。

### P7 — Provider / MCP Multi-Target

后端先完成一个真实Provider read/write与一个canonical MCP read-only，再验证同一Capability Requirement下多个Target的Rank/Select/Fallback。所有目标沿用Risk、Approval、Invocation、Verification和Truth，MCP不成为新Engine；结果未知的写入先Reconciliation，不盲目换Target重写。

资源页统一呈现连接、授权过期、权限不足、健康、能力范围、最近证据、读取/执行能力；本机/云端/其它设备/接口四类不变，MCP进入接口。会话/计划解释能否完成与缺什么，普通流程不暴露协议名。

P7 DoD：真实Provider Target、MCP Target、多目标选择、范围内Fallback、ResourceGap与Verification。接口schema或Catalog存在不算可执行证据。

### P8 — Android UI Agent / AppSkill

复用受控Observe→Find→Policy Gate→Proposed Action→Approval→Act→Observe→Verify链。AppSkill属于执行层，描述package/version/pageTypes/selectors/supportedFacts/supportedActions/dangerousActions/verificationPoints，与P6业务Skill分开。首批只接1～2个真实App，从读取和低风险写入开始，不含付款、转账、删除或高风险发布。

资源页展示App当前版本、可读取/执行内容、所需权限和最近验证；会话承载一次操作，计划承载长期能力。审批说明“将在XX App做XX操作”，不展示Accessibility action编号。

P8 DoD至少一个真实App完成Goal→Observe→Proposal→Approval→UI Action→Read-back→Verification→Truth，且操作经过既有权威链。

### P9 — Windows Runtime

沿用TrustedDevice、DeviceCapability、DeviceTask、RuntimeTarget，使PC成为第二种正式设备Target。v1限定heartbeat、manifest、file.read、sandbox内file.write、clipboard、browser.open、notification与artifact；明确权限和范围，不开放unrestricted shell。

资源→其它设备→Windows PC呈现在线/离线、能力、权限、最近心跳/真实证据和可操作范围。会话表达“在电脑上完成”或由Resolver选择，用户不操作RuntimeTarget IDs。

P9 DoD：同一Goal/Plan经Resolver选择Windows，真实Plan→Task→Result→Verification→Truth，并按本阶段冻结范围验证离线、重连、旧epoch和重复Task。

### P10 — Cloud Workspace + Capability Synthesis

Cloud提供隔离filesystem、browser、HTTP、Python/JS sandbox、artifact、credential broker、lease、timeout与evidence。缺失能力按OpenAPI/MCP Schema/Browser Recipe→Capability Candidate→Schema Validation→Sandbox→Permission/Risk Analysis→Verification Contract→Signed Manifest→Registry→Resolver受控提升，不将AI生成代码直接变成生产工具。

仍进入五页：资源展示Cloud能力、新候选与待授权能力；会话解释新解决方式；长期Plan只通过新的合法PlanVersion采用新增能力；服务仍表示现实履约，不增加Cloud一级页。

P10 DoD至少一项真实缺失能力完成发现→Candidate→Sandbox→Risk→Manifest→Registry→Resolver→Runtime→Verification；Candidate存在或沙箱成功不等于生产授权或现实Truth。

### P11 — Cross-Target Final Closure

本阶段只封版，不增功能。真实矩阵包含自然语言Temporary、USER_EVENT、Skill→Persistent Plan、ResourceGap→Resume、Android/Provider/MCP/Service/UI Agent/Windows/Cloud、GitHub Skill→Plan与Capability Candidate；任何未有实际证据的保持Pending。

按各阶段既定范围汇总offline、permission/credential revoke、lease expiry、worker crash、duplicate、result loss、ACK loss、stale epoch、sourceVersion change、OUTCOME_UNKNOWN、reconciliation、replan、pause与version replacement。复用已有关闭证据并检查新Target特有边界，不无限新增fault case或篡改历史。

五页及全部二三级页做最终走查：字号、间距、顶部/导航、列表/分隔/按钮、状态、空/加载/错误、权限/确认/审批、Candidate/Truth/Result/恢复、隐私与无障碍；若保留深浅色则同时验证。CI、发布、安全/性能与Repository Hygiene按实际门禁完成，不能以本地通过宣称GitHub Green。

## Mobile Product System Track（P4～P11）

这是每阶段随行的产品工程轨道，不是新的P编号。统一PageShell、TopBar、Section、Row、Divider、Tabs、Status、InlineNotice、ActionSheet、Confirm、Approval、ResourceState、CandidateState、TruthState、ResultState、EmptyState、LoadingState与ErrorState的语义、尺寸、层级和交互，不要求全部做成卡片。

视觉保持黑白、简洁、低装饰、少卡片、清晰层级；不堆粗边框和彩色状态。完整规则与交付记录见 [MOBILE_PRODUCT_SYSTEM_TRACK.md](MOBILE_PRODUCT_SYSTEM_TRACK.md)。后端能力越丰富，用户表面越清晰。

## 前后端开发次序与统一关闭Gate

P3 CLOSED后依次P4→P5→P6→P7→P8→P9→P10→P11。每个阶段先完成Backend + Mobile真实联调和该阶段验收，再更新文档/ledger标CLOSED并进入下一阶段，不先做完全部后端再补手机。无依赖的设计或工作可并行，例如P5后端设计与P4移动端收口；不得绕过当前关闭门或让产品层长期落后多个阶段。

| Gate | 关闭前必须满足 |
| --- | --- |
| Architecture | 没有新平行Engine，没有破坏既有Authority |
| Backend | 阶段Contract/API/DB/Worker/Runtime正确，必要迁移安全 |
| Frontend | 正确归属冻结五页，信息状态、操作和恢复入口完整 |
| Integration | 前后端真实联调通过 |
| Automation | 按改动完成contract/unit/integration等必要回归 |
| Reality | 真实设备、账号或服务满足该阶段验收，不用mock替代 |
| Truth | Candidate、Tool success、ACK与Verified Truth分别记账 |
| Recovery | 按本阶段冻结范围核实重启、离线、撤权、重复等边界 |
| UX | 真机截图、层级、文案、状态、交互检查通过 |
| Evidence | 自动测试与真实证据分开，记录版本、时间、身份与限制 |
| Closure | 阶段文档及ledger更新后才能CLOSED，未完成项不得隐去 |

Gate按阶段适用，不强迫每个只读产品阶段新增副作用或所有故障。合同、Runtime、Product和Real Evidence任一必需DoD缺失，均不能因为tests/API build通过提前关闭。当前P3仍仅三项待验，不因本总计划追加条件。

## P0 与 P6 的迁移边界

- 现有 13 领域可作为首批 category/tag；数量不再是固定产品权威。19 旧领域仅保留 Legacy 兼容。服务对象 kind 与领域分类仍独立，不能混用。
- Scenario 退为受控 Recipe metadata、useCases、evaluationCases；保留现有合法合同校验，不直接去掉 scenario 校验制造无效 Draft。新路径在受控 Skill 合同就绪后替代用户先选场景的入口。
- 旧 Template 在 P0 去权威化，P6 逐项迁为 Official Skill 或 Deprecated；不批量删除历史引用。
- 旧 Strategy 不再要求用户先选，有价值语义保留为 Planner/automation/risk policy。
- PlanSkillReference 冻结 0～N 个 SkillEntryRevision，Repository commit 与 EntryRevision 分开；更新仓库不得改变运行中 Plan。GitHub 内容先 Parse/Classify/Capability Analysis/Risk/Compatibility，再成为 Candidate/Version；不可直接 clone/install/run。
- GitHub 业务 Skill 属于 Skill仓库；MCP Server 属于资源；AppSkill 属于执行层；代码项目进入 Sandbox/Capability Candidate，不能混为业务 Skill。

## 已有真实checkpoint与证据入口

P1 已关闭：正常定时链、既定故障矩阵、真实 lease takeover/stale terminal fencing、event18 commit-gap reconciliation continuation 均已验收。证据完整保留，详见 P1_FAULT_ACCEPTANCE.md 最新收口记录；不再新增 Calendar fault case。

P2 已关闭：内部USER_EVENT复用已有事项authority，单次生命周期、owner isolation、时区、ScheduleProjection、站内提醒及显式外部create/update/delete均真验。PLAN与冻结USER_EVENT_SYNC共用Runtime，permission/offline/commit-gap恢复及真实重复交付无重复mutation。详见P2_USER_EVENT.md、P2_EXTERNAL_SYNC.md及artifacts/v83-p24-final-acceptance-reviewed.json。默认自然语言提醒不要求Calendar读写；完成不删除外部记录，取消后的删除单独确认/审批。提醒不宣称Android OS push。不新增CalendarEngine。

P3当前批次详见[P3_RESOURCE_GAP.md](P3_RESOURCE_GAP.md)，最终离线复核见[57/57验收证据](../../artifacts/v83-p3-plan-acceptance-final-reviewed.json)。京东临时Goal Auto Resume已REAL_VERIFIED，其完成空读不可追加或改写。同一长期通知Plan/v1经真实DeepSeek、UI确认启动，在资源恢复后获得四条VERIFIED_EMPTY只读Task并保留Invocation/Ledger投影。历史first（a759ff5a）、second（bd04a04c）和最后窗口3e43a9a4的空读WAIT均有审计证明；ff7e4d21为同窗口attempt 2，已完成空读，但采集审计中无自身WAIT，不将最后窗口的WAIT归到该重试。来源版本变化及本机grant导致epoch变化后，旧已完成读取holder的heartbeat/fail/complete各409拒绝，恢复读取仍属于原PlanVersion/合同。未实际换设备，不将旧holder重放冒充in-flight process death。真实记录见[恢复快照](../../artifacts/v83-p3-plan-epoch-restored-real.json)、[source拒绝](../../artifacts/v83-p3-source-fence-probe-real.json)、[epoch拒绝](../../artifacts/v83-p3-epoch-fence-probe-real.json)。

r5[安装快照](../../artifacts/v83-p3-plan-installed-final-real.json)的已复核当前状态为WAITING_RESOURCE，listener health为UNKNOWN，原因为APP_SOURCE_GRANT_REQUIRED/FRESH_CAPABILITY_EVIDENCE_REQUIRED；历史WAITING_FACT_CHANGE不代表安装后持续处于该状态。四条Task、Invocation（含Ledger投影）及Acquisition与epochRestored完整不变，安装观测区间无额外read reservation；结论仅覆盖已记录区间。backend r4健康检查已200、r6 APK已安装；正常登录、系统监听连接与原京东本地来源恢复后，同一Plan/v1自动完成当前窗口attempt 2，HEALTHY / VERIFIED_EMPTY → WAIT，保留旧来源失败attempt及前四条历史。见[当前恢复](../../artifacts/v83-p3-plan-r6-current-real.json)。

用户确认当前无真实京东物流通知；Shipment Candidate→Truth、正向Truth发布一致性及真实长期Plan Truth→Assessment→异常站内提醒→Replan/WAIT仍REAL_PENDING，**P3整体IN_PROGRESS**。P3最终DoD只剩这三条连续真机Truth证据；纯自动requestRebind独立验收不作为关闭blocker。三项齐全后直接P3=CLOSED，冻结京东通知验收线，进入下一阶段；不追加ResourceGap类型、Calendar故障或其它Target。提醒交付仍不包括Android OS push。

未知写结果不得盲目 fallback 到第二 Target；先 Reconciliation，确认未产生副作用且授权范围允许后才重算。WAITING_RESOURCE 的恢复必须验证 capability 真可用，连接成功或 installed 本身不足以续执行。

P11 以实际验收覆盖自然语言临时 Action、0～N Entry组合→Plan、USER_EVENT、scheduled Plan、ResourceGap、Android/Provider/MCP/Service/UI Agent/Windows/Cloud、GitHub Skill 与 Capability Candidate。任何未有真实证据的保持 Pending，不能宣称 V8.3 Done。



P6正式基线见 [SKILL_REPOSITORY_DESIGN.md](SKILL_REPOSITORY_DESIGN.md)。Skill仓库Tab的+最终为接入来源；Entry用于当前需求或开始会话，不直接创建Plan。入口兼容到P6实施，当前P3等待真实数据，不提前开发后续UI。



2026-10-08 22:56统一基线：[V83_UNIFIED_BASELINE.md](V83_UNIFIED_BASELINE.md)。P1 CLOSED / P2 CLOSED；内部USER_EVENT保持独立权威，外部同步关联实际执行版本与现实证明，不建立双主状态。下一主线P3 ResourceGap Auto Resume。
