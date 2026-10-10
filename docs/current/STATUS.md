# 当前状态 — 2026-10-10

2026-10-10 最新后续开发收口：[V89-SKILL-05 方法版本更新与历史](V89_METHOD_REVISIONS.md)完成本人文件预览、变化核对、原 API 追加和 owner-only 分页历史；旧版本、原 Plan 引用与规划开关保留。首轮发现原分页 DTO 接受 limit=0，修正完整边界校验后 API 4 文件 46/46（新专项 14/14），Mobile 399/399（新专项 11/11）、Plan-schema 251/251、八包 typecheck 和 API/Web/Android Hermes 构建通过。零新 SQL，12 个独立文件哈希不变；按已有授权推送当前 codex 分支。V89/V90 现实验收继续 IN_PROGRESS；下一独立任务为最多三个方法的组合选择入口。

2026-10-10 最新后续开发收口：[V89-SKILL-04 方法资源能力核对](V89_METHOD_RESOURCES.md)完成原会话按所选方法分组的实际资源状态、缺口与恢复入口，复用原 Resolver/授权/Health/原生证据；缺少 App 范围或当前 Adapter 时拒绝就绪，方法声明风险不降低实际操作风险。API 7 文件 71/71（含新专项 14/14）、Mobile 388/388、Plan-schema 251/251、八包 typecheck 与 API/Web/Android Hermes 构建通过。零 SQL 迁移，12 个独立文件哈希不变，按已有授权推送当前 codex 分支。V89/V90 真实验收继续 IN_PROGRESS；下一独立开发任务为方法版本更新管理入口，见 V90 最新联合记录。

2026-10-10 最新后续开发收口：[V89-SKILL-03 方法会话入口](V89_METHOD_CONVERSATIONS.md)完成明确选择方法、固定引用、原会话中的版本/可用状态，以及 Plan/一次性确认时的方法冻结。最终 API 8 文件 73/73、首组方法仓库/原一次性审批 19/19（重叠专项不累计）、Mobile 388/388、Plan-schema 251/251、八包 typecheck 与 API/Web/Android Hermes 构建通过。零 SQL 迁移，12 个独立改动文件哈希不变；按已有授权推送当前 codex 分支。V89/V90 真实验收继续 IN_PROGRESS；下一任务是所选方法的实际资源能力核对与缺口入口，见 V90 最新联合记录。

2026-10-10 最新中断恢复收口：已按用户要求检查完整 git diff 和工作区，保留原修改，无回滚。[V84-TASK-02](V84_TASK_ORCHESTRATOR.md)完成取消/失败后未开始任务收口与正式 VerificationEvidence 校验；续接 [受控 Browser](V87_BROWSER_RUNTIME.md)、Loop 运行历史与 GitHub/URL 方法来源。隔离 API 14 文件 137/137、Mobile 全套 388/388、Plan-schema 全套 250/250、Config 63/63、八包 typecheck、API/Web 构建和 Android Hermes export 均通过。进入本轮前的 12 个登录/设备 Runner 文件经 SHA256 复核不变，不纳入本轮 63 文件提交。用户已授权检查完成后推送 codex/v83-persistent-runtime；历史“不推送”记录由此替代。0090 仅迁移隔离测试库，历史 0083 发布证据门仍失败；V84～V90 现实验收继续 IN_PROGRESS，完整证据见 [联合记录](V90_BETA_ACCEPTANCE.md)。

以下为先前检查点与当时的验证/部署口径，后续结果以最新记录为准。

2026-10-10 最新连续开发：按用户再次提供的 V84→V90 任务书，在保留 V87 真机待验的同时完成 [V88 Loop/Reflection 入口](V88_AGENT_LOOP.md)、[V89 版本化方法仓库](V89_SKILL_ECOSYSTEM.md)与 [V90 五页联合验收准备](V90_BETA_ACCEPTANCE.md)。原 Worker/Task/Approval/Truth 权威保留，无新增自主执行器；方法只以本人启用的非可信参考接入 Planner，原确认同事务冻结版本。受影响 API 59/59、Mobile 全套 387/387、Shared 248/248、八包 typecheck、API/Web 构建与 Android Hermes bundle 通过；Worker 真进程 6/6，容器重启注入 2 项跳过。更广 API 初次运行已中止、共享 Redis 已恢复，三角色探针均 200，全套不宣称通过；夹具队列隔离修正与最终证据见联合记录。0090 仅迁移新隔离 `_test` 库，历史 0083 release evidence 门仍失败，不部署、不覆盖 APK、不推送。当前真实主线仍 V87 Observe/核实；V88 七天与 V89 实际第三方/资源闭环未验，V84～V90 不提前 CLOSED。保留进入本轮前已有的登录/设备 Runner 修改。

2026-10-10 最新进展：[V87-COMPUTER-04](V87_COMPUTER_RUNTIME.md)准备检查发现入队响应丢失后的原生 scope 重启会拒绝已有会话；已修复为同冻结范围复用，保留原队列/有效期及 Goal 确认，变更范围或失效权限拒绝恢复。Mobile 42/42、API/Mobile typecheck 通过；真实 DeepSeek + 隔离 Goal API 3/3，明确页面读取/普通数学/缺少来源分支均无执行或 Truth 创建。Web/bundle/APK 已构建通过并覆盖安装，APK hash 612d5bdc476a26a0638793b901adef9550447d16ecb7a2f6f54eab23463f39cf；源码/内嵌 bundle/安装包字节一致。原生启动失败清理已限制为本次创建且仍匹配的范围。手机当前首次协议页、系统页面权限未开启，本人正常入口/真实页面/核实仍 REAL_PENDING，V87 IN_PROGRESS。本轮仅本地，不推送。

2026-10-10 最新主线：[V87-COMPUTER-03](V87_COMPUTER_RUNTIME.md)已实现原会话页面需求→资源建议→设备签名确认→冻结原目标版本→原 Task 按次读取→候选核实→原会话结果卡片。复用原权威，无迁移；API 主回归 59/59、证据归属/模型补验 20/20、最终原目标归属专项 7/7、Mobile 47/47 通过。Shared/API/Mobile 类型检查、Web/Android/API 构建通过，已本地三角色部署及 APK 覆盖安装并核对字节。本人登录/独立系统授权/真实页面 Golden Flow 仍 REAL_PENDING，V87 IN_PROGRESS。不推送 GitHub。

2026-10-10 当前主线：[V87-COMPUTER-02](V87_COMPUTER_RUNTIME.md)已实现独立 UI_READ consent、只读 native observer、原 Task 签名 dispatch、资源范围确认及候选核实入口。API 79/79、Mobile 44/44、Shared 11/11 与构建通过；无迁移，不推送。本人登录/系统授权/真实页面读取仍待验，V87 IN_PROGRESS。本地部署安装另记证据；下一任务 V87-COMPUTER-03 原 Goal 页面事实需求与合法确认续接。

2026-10-09 当前主线：[V87-COMPUTER-01](V87_COMPUTER_RUNTIME.md)已完成受控页面观察的范围/会话 fencing、原子回滚与任务读取范围表面，41 项 API 和 38 项 Mobile 回归通过，已本地部署/安装。下一任务 V87-COMPUTER-02 显式页面读取授权与 native observer。前序 V86 本地 fda37c0 已部署/安装；V86/V87 的本人真机结果独立待验。无新迁移，不推送。

2026-10-09：[V86-RESOURCE-02](V86_GOAL_RESOURCE_MATCH.md)已实现版本绑定的目标资源核对、公开接口读取来源 fencing 和二级返回入口；自动回归、构建与 APK 安装已有证据，本人正常登录后的 UI/目标调用独立待验。下一任务 V87-COMPUTER-01，沿既有 DeviceTask/受控读取合同推进，不推送 GitHub。

2026-10-09 当前本地主线：[V86 逐项资源能力](V86_RESOURCE_CAPABILITY.md)已实现、自动验证、本地部署与 APK 覆盖安装；下一任务 V86-RESOURCE-02。V85 候选/引用/关系已部署并安装，真实 DeepSeek + 隔离账户完整 API 生命周期 5/5 通过；手机记忆操作仍待正常登录。V85/V86 均不提前 CLOSED，本轮不推送。

主线已切换 [V84–V90 持续开发方案](V84_V90_ROADMAP.md)。P1/P2 CLOSED；P3 ResourceGap 核心机制已收口，三条物流正向证据独立 REAL_PENDING，不阻塞新主线。

V84.1 已实现 `goal-understanding.v1`、Agent intent/planner/policy、原 Planner/审计/消息接入和会话理解卡片。V84.2 已接入本人 timezone/locale 的只读 Context，理解卡片显示采用时区。复用现有确认与 Shared Runtime，无新数据库权威。后端 57 项、移动端 14 项相关回归通过，Plan-schema/API/Mobile typecheck 与构建、Android bundle/APK 构建通过。

本地 API 已更新；V84 r1b APK 覆盖安装成功，构建/已安装 SHA256 一致：`ad52ccb785118dd36b7ed70540cbc17821c7828472fda7382ec3288c8c03b8bd`。只读真实 DeepSeek 探针 8/8：按本人时区正确解析次日下午15:00，USER_EVENT 建议不生成 Plan、外部同步或执行授权。该探针未保存会话/事项，不冒充手机确认链。用户回复暂时无法登录，真机理解卡片与确认验收保留 REAL_PENDING，V84 IN_PROGRESS。详见 [当前任务](V84_AGENT_CORE.md)。

当前进入 [V84 Task Orchestrator](V84_TASK_ORCHESTRATOR.md) 实现/验证：任务图与冻结执行身份同事务生成，运行转换保持原 fencing，计划中展示任务进度。最新顺序为 Task → V85 Memory → V86 Resource Capability → V87 Computer Runtime → V88 Loop → V89 Skill → V90 Beta；下方历史顺序不作为当前阻塞。

V84 Task foundation 已自动验证并推送 `3db6f6b`，进入 [V85 Memory](V85_MEMORY_SYSTEM.md)。用户可控 Store、来源与版本、关闭/编辑/删除、只读 Planner 检索和资源页入口已实现；39 项相关 API 回归通过，最终更正/过期/清除内容专项 8/8。V84/V85 真机体验与记忆模型消费待正常登录，不把构建或隔离模型测试记为 REAL_VERIFIED。

联合更新已部署本地三角色并 ready，0086/0087 已迁移，Task/Memory r1 APK 已安装且字节核对一致，SHA256 `fd4fbf696947b35758d2ec804b3c4ef812f482fb1d5cc57045c5b4a04dd11dce`。Mobile 16 项、API/Web/Android 构建通过；Memory usage 默认关闭，真实操作/模型消费与完整 V85 仍 IN_PROGRESS。历史 0083 production release migration evidence gate 保留未过，不放宽。

最新本地推进：[V85 Memory Candidate/Reference/Graph](V85_MEMORY_CANDIDATES_GRAPH.md) 已实现会话候选、明确确认/忽略、来源与旧版本核对、用户确认的关系和一跳检索；来源/设置/版本与最终发布均受控。63 项 API 与 14 项 Mobile 回归通过，真实模型/手机完整验收仍 pending，V85 IN_PROGRESS。按用户指示本轮不推送 GitHub。

## V8.3 历史 checkpoint

2026-10-09 17:41 导航修复：GitHub checkpoint `7fdbb90` 已推送并核对远端一致后，补上通知来源页固定顶部返回按钮、移除重复导航标题。普通进入使用已有页面历史返回，直达且没有上一页时回到资源；五个一级入口保持不变。Mobile typecheck、Android bundle/APK 构建通过，r8 已覆盖安装并核对手机 APK 与构建字节相同，SHA256 `b5b72d4f17d99556ef1c0f5d1512c044e5352585cce5243e4b2fea95039f2cd4`。已提交的本机来源过滤和监听状态提示随此次源码打包。

真机导航脚本首次采集为全黑画面，返回按钮检查未通过；唤醒后确认手机停在系统锁屏（`mDreamingLockscreen=true`）。这是未完成点按验收，不能记为导航路径 REAL_VERIFIED；原失败记录保留，等待合法解锁后检查正常返回和直达回资源。安装证据与失败记录保留在本机 `artifacts/v83-notification-back-r8-install-real.json`、`artifacts/v83-notification-back-r8-navigation-real.json`。本次仅修用户指出的返回入口，不产生新的 P3 关闭证据或故障矩阵。

2026-10-09 GitHub checkpoint：提交当前源码、测试、数据库迁移和设计文档到 `codex/v83-persistent-runtime`。新产生的本地 `artifacts/` 验收快照、截图、bundle、APK 备份及运行进程文件保留在本机，不随本次提交上传；本文与验收文档中的本地证据链接须在原验收工作区查看。已有受 Git 跟踪的历史文件保留。

该 checkpoint 时不改变阶段关闭结论。r7 候选刷新 APK 已安装；安装后快照中通知监听健康为 UNKNOWN、原 Plan 为 WAITING_RESOURCE，安装复核为 15/16，失败记录保留。当时当前手机来源过滤与监听状态提示已写入源码、Mobile typecheck 通过，尚未打入 APK；通知来源页缺少直达返回入口的问题尚未修复。GitHub 备份优先，其后的导航修复见页首记录。

最新前后端一体化总计划已落实为 [V83_MAINLINE.md](V83_MAINLINE.md)：五个一级页面的名称/数量/顺序/职责永久冻结；P4～P11按后端能力、产品表面、真实证据三轨同步，Contract/Runtime/Product/Real Evidence四项DoD及统一Gate齐全后关闭。[Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)伴随后续阶段，非新P。此次仅统一设计/任务文档；P0 Phase1 CLOSED、P1/P2 CLOSED、P3 IN_PROGRESS，不提前实施P4～P11或增加P3待验项。

2026-10-08 22:56：**P1 CLOSED / P2 CLOSED**。P2内部事项及显式外部同步的冻结验收范围全部REAL_VERIFIED：真实UPDATE保持event20身份，DELETE以现实缺失验证；WRITE权限拒绝、设备离线、UPDATE commit-gap只读回查、确认/启动/真实签名交付重放均保持事项与历史权威，无重复mutation。最终32项证据复核见[关闭证明](../../artifacts/v83-p24-final-acceptance-reviewed.json)及[P2外部同步](P2_EXTERNAL_SYNC.md)。内部完成不删除外部记录，原OUTCOME_UNKNOWN Ledger保留。提醒边界仍是持久化站内通知，Android OS push尚未验收。

USER_EVENT / Calendar sync可靠性线冻结；当前主线为**P3 ResourceGap Auto Resume**。京东首批临时Goal Auto Resume已REAL_VERIFIED：同一Conversation v1授权恢复后自动只读获取、VERIFIED_EMPTY返回原会话唯一答案，App重启后无重复，旧FAILED Task保留。该完成Goal与空读历史冻结，未来新通知只进入新的合法采集窗口。

2026-10-09长期Plan恢复与当前来源fencing已取得真实证据：[最终离线复核57/57](../../artifacts/v83-p3-plan-acceptance-final-reviewed.json)通过。同一Plan `01a11e56-22b8-75ba-a888-7ac702815eb3` / v1经真实DeepSeek、UI确认启用，在WAITING_RESOURCE后随监听器/来源/本机grant恢复自动产生只读Task；四次实际读取均SUCCEEDED/VERIFIED_EMPTY，Invocation Ledger VERIFIED，保留原PlanVersion/合同。历史首次读取、来源恢复读取及最后窗口 `3e43a9a4` 的WAITING_FACT_CHANGE/WAIT均有真实审计；前一窗口 `ff7e4d21` attempt 2成功空读，但采集审计中没有它自身的WAIT，不能借用下一窗口的WAIT证明每次读取均记录WAIT。旧sourceVersion及旧epoch holder的heartbeat/fail/complete各返回409 `STALE_PLAN_NOTIFICATION_AUTHORITY`；探针复用真实**已完成读取**的旧holder，不冒充执行中断，也未实际换设备。详见[恢复快照](../../artifacts/v83-p3-plan-epoch-restored-real.json)、[来源拒绝](../../artifacts/v83-p3-source-fence-probe-real.json)、[epoch拒绝](../../artifacts/v83-p3-epoch-fence-probe-real.json)及[P3验收](P3_RESOURCE_GAP.md)。

r5安装后的[实际快照](../../artifacts/v83-p3-plan-installed-final-real.json)最新状态为**WAITING_RESOURCE**，本机监听健康为**UNKNOWN**，原因是APP_SOURCE_GRANT_REQUIRED/FRESH_CAPABILITY_EVIDENCE_REQUIRED；历史最后WAIT不代表安装后持续WAITING_FACT_CHANGE。四条Task、四条Invocation及四条Acquisition与恢复快照完整相同，两个快照的观测区间没有新增读取预留。后端r4已恢复并通过三个health/ready 200；r6 APK已安装。经正常登录、系统监听连接和京东本地来源恢复后，同一Plan/v1保留旧来源失败Task并自动完成新窗口attempt 2，HEALTHY / VERIFIED_EMPTY → WAIT，见[当前恢复](../../artifacts/v83-p3-plan-r6-current-real.json)。P4布局、Skill、Provider/MCP不扩展。

**P3仍IN_PROGRESS**。用户确认当前没有真实京东物流通知：JD Notification Acquisition为EMPTY_READ_VERIFIED；Shipment Candidate→Truth、含Truth结果发布一致性及真实Plan Truth→Assessment→异常站内提醒→Replan/WAIT仍REAL_PENDING，合同/fixture通过不能代替正向真机证据。P1/P2保持CLOSED，Android OS push仍未验收。下文checkpoint保留历史时点，不覆盖本页当前状态。

最新关闭范围冻结为上述三条真实 Truth 闭环。纯自动 requestRebind 的独立验收不属于本轮 P3 DoD；三项取得连续真机证据后直接 P3=CLOSED，不增加 ResourceGap 类型或其它 Target 验收。完整清单见[P3 最终 DoD](P3_RESOURCE_GAP.md#2026-10-09-冻结的剩余关闭范围)。

当前动作是等待真实京东物流数据，不继续扩展开发。空读 Assessment/WAIT 已验，真实业务 Truth 的异常判断/提醒仍待验；普通物流通知不能充当异常提醒证明。当前阶段固定为P4计划体验、P5Service Runtime、P6Skill仓库均后续，等待期间只准备 [P4设计](P4_PLAN_EXPERIENCE_DESIGN.md) 与 [P6设计](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)，不开发或部署；既有详情主体继续冻结，见[当前主线](V83_MAINLINE.md)。

2026-10-09 16:29继续检查：API/Workers均200，手机连接正常；本次初始监听健康UNKNOWN、原Plan等待资源。恢复开发转发并经正常系统设置重连后，当前Target为ONLINE/HEALTHY，同一Plan/v1自动完成Task `99c9d866`，16:28:10回到VERIFIED_EMPTY/WAIT。京东Receipt/Candidate/Truth/异常提醒仍为0，来源页没有待同步线索；旧Task、Invocation身份与已有Ledger结果保留。见[最新快照](../../artifacts/v83-p3-truth-check-restored-20261009T082921343Z-real.json)和[有界核对](../../artifacts/v83-p3-truth-check-restored-20261009T082921343Z-summary.json)。此恢复使用系统UI，不证明纯自动requestRebind；P3最后三项仍REAL_PENDING。

2026-10-09 11:51历史准备检查：手机已连接，API/Workers均200；恢复丢失的开发API转发后，原Plan/v1自动回到WAITING_FACT_CHANGE/WAIT，Target为ONLINE/HEALTHY。来源页没有待同步线索，Receipt/Candidate/Truth/异常提醒仍为0；旧Task与已有Ledger结果未改写。见[当时快照](../../artifacts/v83-p3-truth-connected-20261009T035119052Z-real.json)和[有界复核](../../artifacts/v83-p3-truth-readiness-recovery-final-reviewed-20261009T035119Z.json)。本次不重开空读验收、不扩矩阵；P3最后三项仍REAL_PENDING。

## V8.1/V8.2 已落地基线

会话历史/CreationDraft、ExternalReference kind+domain与SERVICE投影、统一Share/Paste、资源能力逐项状态、ServiceOffering五种服务方式及四种价格模式已有实现。现有 13 领域降为首批 category/tag，固定数量不再作为产品权威；Legacy Runtime Domain19仅兼容。新主线见 V83_MAINLINE.md，Skill 平台和内部 USER_EVENT 尚未完整实现。真实资源证据与仍缺少真实对象/Credential的Pending见docs/v81-evidence-ledger-2026-10-05.md和docs/v82-resource-capability-progress-2026-10-05.md。

## V8.3

当前采用 V83_MAINLINE.md 的新 P0–P11，旧 0/A–K 编号保留历史记录。P0 Phase 1 CLOSED；P1 CLOSED；P2 CLOSED；P3 ResourceGap IN_PROGRESS，不提前开展P6 Registry。测试与真实证据分别记入 docs/v83-development-ledger-2026-10-05.md。下方较早条目保留历史时点，不覆盖页首最终状态。

CI可由PR或手动触发；尚未取得本轮GitHub Green。不得把合同测试、API200、APK构建、Executor成功当作现实闭环或Production Ready。


## 2026-10-07 Plan 控制页真实投影 checkpoint
用户指定九项详情整改已实现并安装真机：短 Goal 标题、次级安全操作菜单、timezone-aware 时间、匹配冻结 FactDemand 的真实 Truth、中文 Verification、实际执行资源、真实来源、分页运行记录、独立设置/判断依据。详情及测试/Evidence见 docs/current/PLAN_CONTROL_SURFACE.md。现有 PlanVersion/Runtime/Truth authority 不变，无新增外部副作用。本 checkpoint 不等于 P4 整体封版；接下来回 P1 reliability，P6 Registry 不提前打开。

2026-10-07 Plan Detail 主体冻结（P4部分），只修真实语义。P1 fault matrix正式推进；R2权限撤销fail-closed和OS恢复后同wake审批/event10/read-back/ACK/post-write WAIT已有真实证据，缺口待处理投影已补代码，R3等待实际到点UI验收。全P1仍OPEN。Skill仓库最新Repository/Entry/EntryRevision/0～N编排基线已冻结，P6未实施。

2026-10-07 P1最新：heartbeat空闲真机、initial offline/event12恢复、stale epoch旧Task/Result fencing、event14未知结果只读回查→NEEDS_USER已实证，Result/response与ACK-loss分记。P1仍OPEN：正在用同一真实Plan收approval expiry/pause/version既定边界。新Runner无旧stale任务饥饿，26项mobile/14项native-write回归及类型检查通过。Plan Detail与Skill仓库范围不扩，P2未启动。详见P1_FAULT_ACCEPTANCE.md及开发台账。

2026-10-07 20:05：既定approval expiry、到点前pause、版本替换已真实验证。v3在20:02自动调度，UI审批后event15 VERIFIED/ACK，post-write COMPLETE→次日20:02 WAIT；旧v1执行与三个版本hash不变，v2无执行。验收Plan已UI暂停。P1仍OPEN：Worker/App PARTIAL_REAL与lease/mid-executor证据范围待收口，P2未开始。详见台账和固定矩阵；不扩UI/Skill/Target。

22:08 latest：P1 B/C commit-gap→unknown→lookup-only→Truth→resolved continuation→次日21:52 WAIT已真机证实，unknown Ledger保持不变。A终态owner缺口已修/部署/33项通过，真实旧token拒绝探针失败，A仍Pending。P1 OPEN，P2/其他线不进入；详见固定矩阵与台账。


2026-10-08 统一设计基线：[V83_UNIFIED_BASELINE.md](V83_UNIFIED_BASELINE.md)。P1 CLOSED / P2 Phase 1 REAL_VERIFIED；当前下一批为P2 Phase 2显式外部同步，内部USER_EVENT保持独立权威，修改/取消产生受控同步建议，不建立双主状态。当前外部同步未实现，P2整体IN_PROGRESS。

2026-10-08 Multi-authority-source Runtime：PLAN与已确认USER_EVENT_SYNC来源贯穿同一Execution/Resolver/Risk/Approval/Invocation/NativeRuntime；来源结果交接与原Outbox恢复已接通。隔离数据库27项集成回归、共享22项及API/Mobile类型检查通过；0083/0084仅迁移测试库，未部署、未真机验收。公开Planner同步入口仍关闭，P2 IN_PROGRESS。见[P2_EXTERNAL_SYNC.md](P2_EXTERNAL_SYNC.md)。


## 2026-10-08 07:45 P2.3 最新 checkpoint

P1 CLOSED。P2.3 CORE_REAL_VERIFIED，P2仍IN_PROGRESS。真实Android读取10项→DeepSeek USER_EVENT_DRAFT + explicit sync→UI确认→同一Shared Runtime待审批（0写Task）→独立UI审批→event19插入后标准JDWP断点→App真实死亡→自然30秒lease expiry→原Ledger OUTCOME_UNKNOWN→Worker/App重启→lookup-only→正式Verification/Truth→RESOLVED→UserEventExternalLink VERIFIED v1/event19。重复重启后同一Execution、Invocation及唯一event19不变；unknown Ledger不改写，ACK晚于来源交接而最终完成。

复核证据：artifacts/v83-p23-real-sync-acceptance-reviewed.json（18项通过）。生产迁移前后7类原权威按原列hash不变。核心APK 621F643B…；产品投影APK C18785A9…已安装，只展示“手机日历已核对/修改待确认/取消不自动删外部”，不展示Runtime对象。当前手机锁屏/AOD，已请求解锁，尚未将新页面编辑/取消验收打勾。

自动验证：API主回归38/38、共享22/22；新增只读投影/版本/owner集成9/9，API/Mobile typecheck与build通过。重复来源事件真机验收仍REAL_PENDING；编辑/取消外部建议未授权且update/delete当前NOT_IMPLEMENTED，不能冒充已同步变更。P2不CLOSED，不进入P3。

## 2026-10-08 13:14 P2 版本语义与真实请求重放

event19已同步事项真机UI延后时间修改v1→v2、取消v2→v3通过；内部取消后外部19仍保留原09:20–09:50，页面明确需另行确认更新/删除。原Link绑定v1，unknown Ledger/Verification/冻结合同不变。公开合法confirm/start各重放3次，仍是同一Execution/Invocation/Link；复核27项见artifacts/v83-p23-event19-lifecycle-reviewed.json。不将协议重放冒充额外UI确认或重复Source/delivery验收。

新增独立v2 UPDATE/DELETE冻结身份合同、单对象Android mutation参数，旧create v1不改变canonical bytes；尚未接执行链，编译门明确拒绝，绝不落入create。共享28项/API拒绝门2项通过，API/共享typecheck通过。这是合同准备，不是已部署update/delete，更不是P2 CLOSED。剩余重复Source/delivery、update/delete真实链、permission/offline/failure隔离；P1 CLOSED，P2 IN_PROGRESS。


## 2026-10-08 P2.4 / P2.5 执行接入 checkpoint（真机未验收）

UPDATE/DELETE已接入现有USER_EVENT_SYNC→Resolver→独立Risk/Approval→Invocation→NativeCalendarRuntimeService→DeviceTask→同一CalendarInvocationExecutor。服务端从旧Link及正式Verification生成变更建议，客户端只提交version/messageId/confirmed；确认冻结v2请求，不接受客户端Target/外部event身份。WRITE对UPDATE要求active/current事项版本，对DELETE仅允许对应cancelled/current版本；历史lookup仍只消费冻结来源。既有create的合同、Task类型和审批不迁移。

外部变更限定同一Target/device/calendar/eventId及上次验证的operation marker；Native UPDATE/DELETE先持久化PREPARED再调用CalendarProvider，已有journal或lookupOnly只读回查，不重新写。更新按标题/时间/时区/新marker回读；删除只在保留提交前合法身份观察时接受缺失证明。删除写独立calendar_event.presence Truth，不虚构日程时间；新Link为DELETED/externalState=ABSENT，旧请求/Verification/unknown Ledger保留。内部COMPLETE不提出外部update/delete。

新增calendar.update/calendar.delete独立grant，android-local-v4清单；旧v2/v3仍接收，但缺失新能力会撤销其旧可执行投影。Resolver按能力对应grant解析，只允许确认的原设备/Target；permission恢复后用当前authority/manifest投影重新解析，同一Sync Request仍唯一Execution。最小目录迁移0085仅注册delete身份及update/delete别名；真实迁移前后7类核心权威hash相同。

隔离API主回归28/28（旧Native14、Authority6、SharedRuntime6、定义编译2）；并发注册修复及来源执行补充7/7，Shared28/28，Mobile Runner19/19、类型检查与API/Shared/Android构建通过。签名collector合同测试覆盖permission拒绝不损坏v2、update与delete未知结果的lookup-only→Truth→Link、原unknown Ledger不改写、COMPLETE不删除。它们不是真机CalendarProvider证据。

首次同时部署时ExecutionWorker因新absence adapter注册竞争退出；已修幂等注册且保留不可变hash核验，补充并发回归通过后重建/重新部署。部署记录artifacts/v83-p24-runtime-deployment-r2.json；保留首次失败记录。新版APK SHA256 BB039F73037AEDFA4B6BA067EE399CD1B50CAF0DBD145062AA8045AB6F076CF7已构建，ADB当前无连接设备，尚未安装。

P2.4/P2.5状态：CODE_IMPLEMENTED / BACKEND_DEPLOYED / REAL_PENDING。真实update/delete、permission/offline/failure隔离及duplicate Source/delivery仍待手机验收；手机缺失不能替代为offline验收证据。event19仍保留既有现实证据；本checkpoint未对它执行新外部变更。P1 CLOSED，P2 IN_PROGRESS，不进入P3。


## 2026-10-08 22:56 P2 最终收口 — CLOSED

指定APK已真机安装；UPDATE保持event20身份、DELETE缺失Verification、permission/offline隔离、UPDATE unknown只读回查、真实签名回执/来源重放、Worker/Outbox/App重启均通过冻结验收。完成仅内部生命周期，原unknown Ledger与历史合同/证明保留。最终[32项真实复核](../../artifacts/v83-p24-final-acceptance-reviewed.json)全部通过；[完整验收与限制](P2_FINAL_ACCEPTANCE.md)记录真实UI、既有owner协议和JDWP观察的各自范围。

本轮修复UTC自动恢复查询、Drizzle包装重复签名错误500→409、completed回执重放误标CHANGE_PENDING；9项签名权威回归、7项multi-authority集成及API构建通过，修复均部署/对应真路径复验。内部提醒交付仍限定持久化站内通知，Android OS push尚未验收。USER_EVENT/Calendar sync可靠性线冻结，P1 CLOSED、P2 CLOSED；下一主线P3 ResourceGap Auto Resume，本批未开始P3实现。
