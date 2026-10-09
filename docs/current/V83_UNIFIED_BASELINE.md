# 懒人装甲 V8.3 当前统一设计基线

2026-10-09 — **P1 Closed / P2 Closed / P3 In Progress**。内部事项及显式Android Calendar同步的冻结验收范围REAL_VERIFIED；P3最终[离线复核57/57](../../artifacts/v83-p3-plan-acceptance-final-reviewed.json)，临时原Goal及同一长期Plan/v1的历史ResourceGap恢复、空读WAIT与旧sourceVersion/epoch holder拒绝已验。r5安装快照当前为WAITING_RESOURCE，不能以历史WAIT代表安装后持续等待事实变化；最新r6经正常资源恢复后已再次取得真实空读WAIT。京东通知仍仅EMPTY_READ_VERIFIED，Shipment Truth、正向Truth发布一致性及Plan Truth Assessment仍REAL_PENDING，等待真实物流通知。探针来自已完成读取holder，未实际换设备；不冒充执行中断或完整正向Truth验收。详见[P3当前证据](P3_RESOURCE_GAP.md)。Android OS push尚未验收。最终设计不代表全部V8.3能力已实现。

最新总计划统一为 [V83_MAINLINE.md](V83_MAINLINE.md)。五页的名称、数量、顺序、职责永久冻结，二三级体验持续完善；P4～P11采取Backend Capability / Product Surface / Real Evidence三轨同步与四项DoD/统一关闭Gate。[Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)贯穿后续阶段，不新增P、页面或Authority。P1/P2关闭范围与P3仅三项待验保持，不以总计划重开已关闭阶段。

## 产品定位与母结构

懒人装甲是以 Goal 为入口的个人生活操作系统。用户表达要什么，AI/Planner 理解和编排，Skill 提供方法，Resource/Service 提供执行能力，Truth 表示现实，Plan 管理长期目标，Durable Runtime、Verification、Reconciliation 和 Replan 持续推动事情完成。

主结构：Conversation → Goal → GoalExecutionContext → Planner/Router → Temporary Action / USER_EVENT / Persistent Plan → 按需组合0～N个Skill → Fact/Capability Requirements → Resolver → Risk/Approval → Canonical Invocation → Durable Runtime/Target Executor → RuntimeResult/Ledger → Delivery/ACK/Resume → Verification/Reconciliation → Truth/Result → 结束、事项生命周期或Plan Replan/WAIT。

这是概念母结构，不能替代现有协议的实际提交顺序：验证、Ledger与Truth的顺序继续受各自正式合同约束。内部 USER_EVENT 提醒不必经过外部 Resolver/Invocation，Skill也不是每个Goal的必经步骤。

GoalExecutionContext 是只读派生投影，包含交流上下文、MemoryRefs、Truth/Facts、Timezone/Locale、用户偏好、Resource/Capability/RuntimeTarget快照、Skill Candidates、Risk/Approval偏好与Existing Plan Context；不获得任何执行或事实权威。生命周期 TEMPORARY/USER_EVENT/PERSISTENT 与执行模式 DIRECT/COMPOSED/DELEGATED 是不同维度，当前不宣称全部Router模式已实现。

## 对象与权威

| 对象 | 职责与边界 |
| --- | --- |
| Temporary Action | 一次完成并返回结果；不默认创建Plan/PlanVersion/Trigger |
| USER_EVENT | 用户拥有的个人事项，有title/dueAt/reminderAt/timezone/version，可编辑、延后、完成、取消；无需持续Reality Assessment/Replan |
| Persistent Plan | 持续目标，Plan/PlanVersion持有Trigger与长期运行权威，通过现实读取、判断、执行、验证和Replan推进 |
| Skill | 方法，允许0～N个Entry组合；不决定Goal生命周期，不自授权限 |
| Resource/Service | 真实执行能力；Service产品层独立呈现现实履约 |
| Memory | 稳定个人信息和长期偏好 |
| Truth | 经正式Reality/Truth Authority建立的现实可信记录 |
| Plan State | 长期目标当前运行状态 |
| Conversation Context | 当前交流上下文 |

USER_EVENT第一阶段复用recurring_item_profiles、sourceType=user_event、user-event.v1 metadata，owner/version/row lock保护；结束后不可编辑，提醒历史保留。时间offset必须匹配IANA timezone，处理DST缺口/歧义。无新CalendarEngine或第二套Plan调度器。

ScheduleProjection统一展示与时间、用户注意力有关的状态：USER_EVENT、Plan trigger/next run、Approval/Attention、ServiceRequest、Deadline/Follow-up、Result、外部Calendar Truth。各来源保留自己的Authority，投影不能反向控制Plan，也不能成为新调度权威。

Skill仓库正式模型保持SkillRepository → 0～N SkillEntry → 不可变EntryRevision；来源可为官方/GitHub/社区/用户/AI。Bounded SubAgent未来只能返回Evidence/Candidate，不能获得Plan、Truth、Approval权威或绕过Resolver/Invocation。

Capability AVAILABLE需根据实现、连接、授权、userGrant、系统权限、runtime health、fresh evidence计算；Catalog、App安装或tool schema存在不等于现在可执行。

## 产品表面

五个一级页面冻结：日程 / 计划 / 会话 / 资源 / 服务。计划为Skill仓库 / 我的计划。日程展示时间与注意力；计划管理长期目标；会话表达需求并承载临时结果；资源管理数字能力；服务承载现实服务。资源分本机/云端/其它设备/接口。

Plan Detail主体保持冻结，后续轻量化是设计方向，不在P2同步批次重构：主表面解释目标、状态、下一步、最近结果、需处理事项，方法/信息与资源/记录/设置渐进展开。USER_EVENT详情保持轻量：时间与提醒、完成/延后、编辑/取消，不展示PlanVersion或Runtime调试术语。

2026-10-09设计准备：P4计划体验、P5Service Runtime、P6Skill仓库均为后续，P3仍是唯一开发主线。等待真实京东物流数据期间已整理 [P4计划体验设计](P4_PLAN_EXPERIENCE_DESIGN.md) 和 [P6方法/资源组合设计](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)，只准备文档，不开发。Skill提供方法并形成Candidate或受控方案，不直接建立Truth；空读主表面不宣称无快递或无异常。该准备不改变现有Runtime或P3关闭条件。

## 已实现与待实现

| 阶段或能力 | 当前状态 |
| --- | --- |
| P0 Product Authority Cleanup | Phase 1 CLOSED |
| P1 Persistent Plan Reliability | CLOSED / REAL_VERIFIED；Calendar reliability冻结 |
| P2 内部USER_EVENT | Phase 1 REAL_VERIFIED；仅持久化站内提醒 |
| P2 显式外部同步 | CLOSED / REAL_VERIFIED：create/update/delete、版本隔离、失败恢复、来源/交付幂等；可靠性线冻结 |
| Android OS push | 未实现/未验收，不声称后台系统通知可靠送达 |
| Temporary独立专项Golden Flow | 尚未正式专项验收 |
| P3 ResourceGap | IN_PROGRESS；最终复核57/57，历史恢复/空读WAIT及旧sourceVersion/epoch请求fence已验；r5安装快照WAITING_RESOURCE，r6正常恢复后真实空读WAIT；Shipment Truth、正向Truth发布一致性及Plan Truth Assessment仍REAL_PENDING |
| P4 Plan Detail | 主体完成/冻结；轻量化为后续方向 |
| P5 Service Runtime | 真实闭环待完成 |
| P6 Skill仓库 | 设计冻结，正式平台未实现 |
| P7 Provider/MCP、P8 UI Agent、P9 Windows | 后续 |
| P10 Cloud/Synthesis、P11 Final Closure | 后续，未达到 |

P3历史first（a759ff5a）、second（bd04a04c）及最后窗口3e43a9a4的VERIFIED_EMPTY→WAIT均有审计证明；ff7e4d21为同窗口attempt 2，已完成空读，采集审计中无自身WAIT。r5[安装快照](../../artifacts/v83-p3-plan-installed-final-real.json)的已复核当前状态为WAITING_RESOURCE，listener health为UNKNOWN，原因为APP_SOURCE_GRANT_REQUIRED/FRESH_CAPABILITY_EVIDENCE_REQUIRED。四条Task、Invocation（含Ledger投影）及Acquisition与epochRestored完整不变，安装观测区间无额外read reservation；不推断后续区间无新启动。backend r4健康检查已200、r6 APK已安装。经正常登录、系统监听连接与原京东本地来源恢复后，同一Plan/v1自动完成当前窗口attempt 2，HEALTHY / VERIFIED_EMPTY → WAIT；失败attempt和前四条历史保留，见[当前恢复](../../artifacts/v83-p3-plan-r6-current-real.json)。

P1证据保持原样：Worker death→自然lease expiry→takeover；旧holder renew=false、failed/succeeded terminal均409 STALE_EXECUTION_LEASE；event18 commit-gap→OUTCOME_UNKNOWN→lookup-only reconciliation→Truth→RESOLVED→Reassessment→WAIT；无重复副作用，原unknown Ledger不改写。

P2真实站内提醒于23:16到点，完成延后/完成，以及“明天下午3点”的解析、编辑/取消。两个P2会话无Plan关联，全期间无新Calendar create；23:24外部read来自独立旧Plan，不能泛称整个时段所有Calendar活动为0。详见[P2合同与验收](P2_USER_EVENT.md)。

P3最终关闭范围已按用户确认冻结：仅剩真实Shipment Candidate→用户核实→Truth、含Truth发布前的来源/epoch/Truth版本一致性、原Plan/v1消费真实异常Truth→站内提醒→post-result WAIT。纯自动requestRebind单独记账，尚未独立真验，**不是本轮P3关闭blocker**；实际跨设备换绑等未覆盖边界不追加为本轮DoD。三项取得连续真机证据后直接P3=CLOSED，冻结京东通知验收线，进入下一阶段。

## P2 已关闭：显式外部同步权威基线

目标：“明天下午3点提醒我去医院，同时加到手机日历”。确认产物为一个USER_EVENT + 一个显式External Sync Request；不创建Calendar Plan，也不只创建外部Event。

内部USER_EVENT始终权威；同步经既有Capability Requirement calendar.event.create、Resolver、Risk/Approval、Invocation、Durable Runtime、read-back Verification、External Calendar Truth，再形成VERIFIED identity link。外部Event不可反向成为内部事项权威，不建立双主状态。

UserEventExternalLink已作为独立持久化结果投影实现并绑定真实event19：userEventId、targetId、capabilityId、externalResourceType/Id、lastSyncedUserEventVersion、syncState、lastInvocationId、lastVerificationRef、lastSyncedAt；必须owner隔离并绑定真实Verification。

同步语义采用**显式开启同步，后续修改产生同步建议**：内部编辑/延后立即按自身合同提交，外部update必须经过现有Risk/Approval Policy，未经验证不推进lastSyncedUserEventVersion。取消内部事项立即停止内部提醒；外部删除/取消另行产生建议并走正式授权合同，不能默默删除。完成内部事项不默认删除外部事件。缺少update/delete实现时明确显示待处理，不以第二次create替代update。

permission/offline/失败不得回滚或破坏内部事项；结果未知先Reconciliation，不盲重试或换Target。明确保留内部版本与已验证外部版本差异，旧版本Result不能把新版本标成已同步。update/delete已部署并真机验证：event20身份不变后删除，event21更新未知结果只读回查，event19离线删除恢复。完成仅改变内部生命周期，保留实际同步版本与原证明。

P2关闭要求已达到：内部生命周期/时区/投影/默认零外部副作用；显式create及read-back；内部外部identity link；修改update、取消delete语义；失败/permission/offline不破坏内部事项；来源、确认、执行及真实回执重放不产生重复mutation。最终32项证据见[P2关闭证明](../../artifacts/v83-p24-final-acceptance-reviewed.json)。下一主线P3 ResourceGap Auto Resume，本批尚未实现；不扩P1故障、UI、Skill或Provider/MCP。

后续开发继续坚持：合法同步确认不等于执行审批，编辑/取消保持内部权威，外部变更建议仍需独立授权。下面保留早期部署checkpoint，其待验状态不覆盖上方关闭记录。

2026-10-08 13:14补充：event19关联事项真实UI延后时间修改v2、取消v3与同步待确认状态已验证；外部保持已执行v1。原确认与start各重放3次仍为同一执行/Invocation/外部身份，unknown Ledger与历史证明保持不变。v2 UPDATE/DELETE冻结变更合同已补，尚未接执行链且明确拒绝编译为create；重复Source/delivery、真实update/delete与失败隔离仍未关闭。复核见artifacts/v83-p23-event19-lifecycle-reviewed.json。


2026-10-08最新：P2 UPDATE/DELETE已在同一Shared Runtime接入服务端派生建议、冻结确认、独立审批、Native变更/lookup-only与Verification/Truth/Link。后端已部署，新APK已构建；ADB无手机连接，尚未安装或真机验收，P2仍IN_PROGRESS。旧NOT_IMPLEMENTED段落为历史checkpoint，当前准确状态CODE_IMPLEMENTED / BACKEND_DEPLOYED / REAL_PENDING。详细证据与限制见P2_EXTERNAL_SYNC.md最新checkpoint。
