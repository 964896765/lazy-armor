# 当前任务书 — V84–V90

2026-10-09 最新授权：**继续本地开发，暂不推送 GitHub**。当前 V85-MEMORY-02/03 [候选确认、引用核对和关系图](V85_MEMORY_CANDIDATES_GRAPH.md)已实现并通过自动验证；继续本地构建、部署、安装与 V85-MEMORY-04 的独立验收工作，不重复问是否继续。先前推送记录是历史 checkpoint，不构成本轮推送授权。

当前任务 V85-MEMORY-01 [Controlled Memory Store & Planner Context](V85_MEMORY_SYSTEM.md)：Backend/Frontend/Database/Runtime 均已实现，自动检查与构建通过后保存 checkpoint。Memory 的 AI 候选提取/确认、关系图与真实消费仍属 V85 后续任务；不提前切到 Computer Use。

最新任务：V84-TASK-01 [Task Orchestrator Foundation](V84_TASK_ORCHESTRATOR.md)。按照用户冻结顺序连续推进：Task → V85 Memory → V86 Resource Capability → V87 Computer Runtime → V88 Agent Loop → V89 Skill → V90 Beta。实现后端、数据库和移动端任务进度，沿既有多来源 Shared Runtime，不再次返回 P3 空读验收。当前 VALIDATING；正常登录待恢复不阻塞独立开发。

2026-10-09 最新指令：按 [V84–V90 总方案](V84_V90_ROADMAP.md)继续开发。[V84.1 Agent Core / V84.2 GoalExecutionContext](V84_AGENT_CORE.md)已实现会话理解、受控确认解释与本人时间设置，并完成回归/构建/本地API部署/Android安装。只读真实模型合同通过，手机确认链待正常登录；V84 不提前 CLOSED。五个一级页保持日程 | 计划 | 会话 | 资源 | 服务。

P1/P2 CLOSED，P3 核心恢复机制从主开发线移除，物流正向证据独立待验，不循环空读、不阻塞 V84。复用既有权威，每个任务同步 Backend/Frontend/Database/Runtime/Tests/Acceptance，自动回归与真机分别记账。

## V8.3 历史任务书（以下不是当前执行阻塞）

2026-10-09最新执行规则以 [P0～P11前后端一体化总计划](V83_MAINLINE.md)为准。五个一级页面名称/数量/顺序/职责永久冻结；新能力只接既有Manifest/Capability/Resolver/Invocation/Runtime/Verification/Truth，不增平行Engine。P3 CLOSED后P4→P5→P6→P7→P8→P9→P10→P11逐阶段Backend + Mobile联调、真验、更新文档/ledger后CLOSED，不先堆完后端再补产品。

每阶段同时检查Contract DoD、Runtime DoD、Product DoD和Real Evidence DoD，以及Architecture/Backend/Frontend/Integration/Automation/Reality/Truth/Recovery/UX/Evidence/Closure Gate。范围按阶段冻结，自动回归与真实证据分别记账，不能以tests/API build通过代替完成。[Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)统一后续状态、层级、组件语义和交互，不是新P或提前开发许可。无依赖设计可并行，但不能跳过当前关闭门。下方旧顺序与checkpoint只保留历史。

2026-10-09当前执行：**P1 CLOSED / P2 CLOSED / P3 IN_PROGRESS**。临时京东Goal Auto Resume已REAL_VERIFIED并冻结。长期通知Plan `01a11e56-22b8-75ba-a888-7ac702815eb3` / v1的资源恢复、四条真实SUCCEEDED/VERIFIED_EMPTY只读Task及原Invocation Ledger已通过[最终离线复核57/57](../../artifacts/v83-p3-plan-acceptance-final-reviewed.json)，保留原PlanVersion/合同，未重新创建或确认计划。历史首次、来源恢复及最后窗口 `3e43a9a4` 的WAIT有各自真实审计；`ff7e4d21` attempt 2成功空读但采集审计没有自身WAIT，不把下一窗口WAIT扩张为每次读取都记录WAIT。来源版本变化与本机grant引起的epoch变化分别使旧真实holder的heartbeat/fail/complete各409 `STALE_PLAN_NOTIFICATION_AUTHORITY`；探针来自已完成读取，不声称in-flight中断或真实设备更换。恢复快照及两类拒绝记录见[P3_RESOURCE_GAP.md](P3_RESOURCE_GAP.md)。

r5安装后的[实际状态](../../artifacts/v83-p3-plan-installed-final-real.json)是**WAITING_RESOURCE / listener health UNKNOWN**，原因APP_SOURCE_GRANT_REQUIRED/FRESH_CAPABILITY_EVIDENCE_REQUIRED。四条Task、Invocation、Acquisition与恢复快照完全不变，安装观测区间没有新读取预留；已验证的历史WAIT不代表安装后一直WAITING_FACT_CHANGE。后端r4三个health/ready已200，r6 APK已安装。正常登录与来源门恢复后，同一Plan/v1自动完成当前窗口attempt 2，真实HEALTHY / VERIFIED_EMPTY → WAIT；失败attempt与前四条读取历史保留，见[当前恢复](../../artifacts/v83-p3-plan-r6-current-real.json)。P3仍不关闭。

剩余范围限定：真实Shipment Candidate→用户核实→Truth；含Truth发布前的权限/来源一致性；真实长期Plan消费Truth→Assessment→异常站内提醒→Replan/WAIT。用户确认目前无真实京东物流通知，这些正向链保持REAL_PENDING，不造通知、不改已完成空读、不新增其它Target或Calendar故障。Android OS push仍未验收。下文旧checkpoint保留历史时点。

P3 最终 DoD 已按用户确认冻结为上述三项。现有 Temporary/Persistent Auto Resume、health/collection、sourceVersion/epoch fencing、历史保留、重启恢复和空读语义均维持 REAL_VERIFIED。纯自动 requestRebind 单独记账，尚未 REAL_VERIFIED，**不作为 P3 关闭 blocker**。三条连续真机 Truth 证据齐全后直接 P3=CLOSED，不追加 ResourceGap 类型或新的可靠性场景。

当前动作已冻结为等待真实京东物流数据，保留同一 Plan/v1 的合法采集，不继续开发或重复验收空读。真实普通物流通知可推进 Candidate/Truth 与发布分支；异常提醒仍必须消费符合冻结异常规则的真实 Truth。P4计划体验、P5Service Runtime、P6Skill仓库均为后续；等待期间已准备 [P4设计](P4_PLAN_EXPERIENCE_DESIGN.md) 与 [P6方法/资源组合设计](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)，仅文档，不开发。既有详情主体冻结，正式Skill平台与后续资源尚未完成。当前阶段口径见 [V83_MAINLINE.md](V83_MAINLINE.md)。

> 2026-10-07 主线已更新：以 [V83_MAINLINE.md](V83_MAINLINE.md) 的新 P0–P11 为准。下文旧编号与 checkpoint 作为历史记录保留，不再作为当前产品路径。P0 去权威化、P6 迁资产；P1 收可靠性，P2 优先补内部 USER_EVENT。历史 PlanVersion 与 Evidence 不删除。

按 V8.3-0 → A RuntimeTarget → B Canonical Capability → C Invocation → D Runtime Projection → E Result Ledger/ACK/Resume → F/G Android/Provider/MCP/Windows → H Cloud Workspace → I Capability Synthesis → J Persistent Replanning → K Golden Flow 连续推进。

仅补现有权威链协议层，不新建 Plan/Truth/Execution/ToolTaskRegistry。保留所有现有未提交实现和真实Evidence，migration append-only。真实Credential、不可逆副作用、OS人工权限、破坏性迁移或不明确的authority/fencing需要Hard Stop；其余阻塞fail closed并继续独立工作。

每个Checkpoint运行全仓typecheck、受影响package完整测试及专项测试。Schema变化验证MySQL8.4、owner isolation、并发、幂等和迁移安全。合流前运行hygiene、terminology、data truth、migration safety、全仓真实DB测试、build、db:rc-integration和Android verification。

完整CI现已提供pull_request及workflow_dispatch；保留MySQL8.4、backup/restore、real DB和Android gate。本地通过不能写成GitHub Green。真实验收和自动测试分别记账。

## 2026-10-06 用户调整后的连续主线
按 P1 真实定时 Persistent Plan Golden Flow → P2 ResourceGap 自动 return/resume → P3 Plan Detail → P4 Service Runtime Reality Verification → P5 Provider/MCP → P6 Business Skill/Template → P7 Android UI Agent → P8 Windows → P9 Cloud Workspace → P10 Capability Synthesis → P11 Final Closure 推进。
P1 未有真实到点证据前不得用人工触发、fixture、Executor success 或 ACK 冒充闭环。各项状态与阻塞记录在 v83-development-ledger-2026-10-05.md，继续保留所有本地修改和真实 Evidence。

## 2026-10-06 P1-A 实际创建链 checkpoint
真机会话经真实模型 Proposal、受控 Calendar Recipe、CreationDraft、SourceResolver、用户 UI 确认、PlanVersion 冻结和应用后进入 ACTIVE。23:24 实际到点读取已 VERIFIED/ACK，自动 Assessment 仍引用过期 Truth，NBA=REFRESH_SOURCE，未到达写审批。P1-A 已达到实际创建/启用；P1 仍 REAL_EVIDENCE_PENDING，不进 P2。保留当前真实 Plan 和所有拒绝/到点证据；不得手工触发、放宽 freshness 或插数据库补齐。后续只能沿现有 Reality/Truth 处理真实刷新及自动续行缺口，不扩 UI、Target 或其它资源系统。


2026-10-07 P1-B: SELECT-only actual trace proves content-dedupe severed event 6's fresh Observation from Candidate/Truth (category B). Native Calendar Observation-scoped dedupe and committed acquisition-to-exact-Truth continuation implemented; seven contracts plus 30-test authority and 9-test strategy regressions pass; API typecheck/build pass. Phone UI created and activated real Plan `01a11433-ffe6-7758-8fb8-ef92cfe29edd`, first due 10:38 Asia/Shanghai Oct 7, no executions before due. Stop code expansion and wait actual scheduler. Overall P1 remains REAL_EVIDENCE_PENDING until fresh Truth consumption, scheduled approved write/read-back and authoritative post-write Assessment/Replan/NEXT WAIT are actually observed. Do not move to P2.


## 2026-10-07 P1-B 实际验收收口
P1-B REAL_VERIFIED：10:38 真实时间触发，实际 read 的新 Observation/Candidate/Truth 被当前冻结 FactDemand/Assessment 消费，SCHEDULE NBA=EXECUTE。手机实际审批续行同 Invocation，日历 event 9 创建/read-back VERIFIED、写 Ledger/ACK 完成。随后真实 Worker 重启自动恢复已提交结果，实际 Recipe 输出 Truth 被 post-write StateAssessment 消费，本次 COMPLETE → persistent Replan READY/NBA=WAIT → nextRunAt 2026-10-08 10:38 Asia/Shanghai；只读 CalendarProvider 查询仅一条该标题事项，无重复 write Task/Invocation。旧 checkpoint 与 Oct 6 失败现场保留。
本次正常主链为 REAL_VERIFIED_WITH_AUTOMATIC_POST_WRITE_RECOVERY；全 P1 边界/故障矩阵和 V8.3 仍未封版。8 文件/53 项 API 回归通过；其它最终检查见台账。严格停在本轮 P1，不扩 P2、UI 或 Target；暂停前到点、版本切换、后台/离线、审批过期和 scheduled response/ACK-loss 等未取得实际证据的继续 Pending。不得用历史手工 event 7/8 或隔离 fixtures 代替。

本轮最终检查：全仓 typecheck 8/8 通过，API build 通过，53 项相关 API 回归通过；当前后台服务运行验证后的构建。系统日历真实 UI 确认 event 9 为今天 11:00–11:10，验收截图 `artifacts/v83-p1b-calendar-view-final.png`。后续 P1 剩余边界继续待验；本轮没有打开 P2。

2026-10-07 日程产品边界已收口：Plan 权威 + 既有 ScheduleProjection + 可选独立 USER_EVENT；外部 Calendar 仅为资源，默认内部提醒不产生外部读写要求。具体约束见 docs/current/SCHEDULE_AUTHORITY.md。P1 Calendar 验收合同及既有真实 Evidence 保留，个人事项实现不冒充已完成。

2026-10-07 P0 Phase 1 CLOSED：依赖分类、现行口径、最终 APK 真机入口/Draft/历史版本核对完成，见 P0_AUTHORITY_CLEANUP.md。当前主任务转回 P1 reliability；P6 Registry 不提前开展。

## 2026-10-07 Plan 控制页真实投影 checkpoint
用户指定九项详情整改已实现并安装真机：短 Goal 标题、次级安全操作菜单、timezone-aware 时间、匹配冻结 FactDemand 的真实 Truth、中文 Verification、实际执行资源、真实来源、分页运行记录、独立设置/判断依据。详情及测试/Evidence见 docs/current/PLAN_CONTROL_SURFACE.md。现有 PlanVersion/Runtime/Truth authority 不变，无新增外部副作用。本 checkpoint 不等于 P4 整体封版；接下来回 P1 reliability，P6 Registry 不提前打开。

2026-10-07 最新指令：冻结 Plan Detail 主体，集中 P1 六组真实故障验收，见 P1_FAULT_ACCEPTANCE.md；仅真实标准满足后 P1 CLOSED，再连续进入 P2 USER_EVENT。

Skill仓库2026-10-07最新正式合同为Repository→Entry→EntryRevision→0～N Planner Composition，PlanSkillReference冻结引用，详见SKILL_REPOSITORY_DESIGN.md；P6按V1/V2/V3实施，不提前抢P1。
