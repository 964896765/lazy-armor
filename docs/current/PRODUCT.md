# 懒人装甲产品定义

懒人装甲是以Goal为入口的个人生活操作系统。用户表达想要什么，Planner判断这是一次性任务、内部个人事项还是长期目标，按需组合方法并解析真实资源/服务，通过受控Runtime、Verification、Truth与恢复机制推动事情完成。

## 用户主线

```text
Goal / Conversation → GoalExecutionContext → Planner / Router
  → TEMPORARY / USER_EVENT / PERSISTENT
  → 按需 0～N Skill → Facts / Capability Requirements
  → Resolver / ResourceGap → Risk / Approval
  → Shared Runtime → Verification / Reconciliation → Truth
  → Result / 事项生命周期 / Assessment / Replan / WAIT
```

临时需求形成Action Proposal并一次结束；“明天下午3点提醒我”默认形成内部USER_EVENT，不创建Plan或手机日历；持续需求经CreationDraft、用户确认和PlanVersion冻结成为Plan。Skill平台尚待P6接入，简单事项可不用Skill；旧模板不能冒充已迁移方法。新建从自然语言开始，不要求先选领域/场景/模板。内部提醒不必经过外部Invocation，显式外部同步才进入已验证的受控Shared Runtime。

## 信息架构

五个一级页面的名称、数量、顺序和职责永久冻结为：**日程 | 计划 | 会话 | 资源 | 服务**。不新增首页、问一问、Skill、Agent、MCP、Runtime、Todo或Automation一级入口。二三级结构、视觉、交互、状态与恢复路径随阶段持续优化。

- 日程：时间、状态、需要处理、运行与结果的统一投影。
- 计划：Skill仓库 / 我的计划；新建进入自然语言会话。
- 会话：临时 / 计划两种上下文，理解目标、生成操作方案或计划草案。
- 资源：查看应用、数据、设备、能力、授权和健康状态。
- 服务：发现现实服务，发起请求并跟进ServiceProvider/Offering/Request的履约状态。

业务消息和待处理合并进日程。个人资料、安全、隐私和设置由日程头像进入；系统安全通知与业务动态分开。

## 统一术语

- Goal：用户希望达成的结果。
- Plan：持续完成目标的长期权威。
- Skill仓库：方法知识体系；Repository 包含多个 Entry/Recipe，Planner 可检索组合 0～N 条。PlanSkillReference 冻结 EntryRevision，AppSkill 留在资源执行层。
- Plan Template：历史兼容资产，P6 分类迁为 Recipe/Example/Evaluation Case/Resource Recipe 或 Deprecated，不机械一对一迁移。
- USER_EVENT：用户拥有的内部个人事项，按时间提醒，可编辑/延后/完成/取消，本身无需长期Assessment/Replan。
- Resource：系统真实可读取、调用或操作的RuntimeTarget/Capability，产品层分本机/云端/其它设备/接口。
- Service：替用户完成现实动作的服务供给及履约请求，产品层与数字资源分开。
- Capability：资源能够提供的信息或动作。
- Run：计划的一次推进或执行实例。
- Result：经过验证后交付给用户的结果。
- Attention：需要用户确认、补信息、修复连接或判断的事项。

领域仅为可扩展category/tag；Scenario暂保留受控Recipe metadata和历史执行合同，不作为强制创建入口。旧Strategy用户选择入口退出，合法automation/risk policy保留。历史PlanVersion不删除或放松校验。日程沿用ScheduleProjection，各内部/外部来源保留自身Authority；P2内部USER_EVENT与显式外部同步已CLOSED，Android OS Push仍未验收。

当前阶段以 [V84–V90 总方案](V84_V90_ROADMAP.md)为准，先推进 V84 Agent Core；P1/P2 CLOSED，P3 核心机制已从主线收口，物流正向证据独立待验。后端能力、产品表面与真实证据同步记账，不以构建代替真实完成。[Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)作为体验基线，不新增一级页面，视觉维持简洁、低装饰与清晰层级。

2026-10-07 Skill仓库正式四层：SkillRepository → SkillEntry/Recipe → SkillEntryRevision → Planner Composition/PlanSkillReference。Planner 按 Goal 可检索 0～N Entry，简单 USER_EVENT 无须 Skill。方法仓库没有执行权；MCP/代码/AppSkill 分流到既有资源或 Candidate 链。最终 + 接入来源、Entry 进入会话编排，设计详见 SKILL_REPOSITORY_DESIGN.md，P6 尚未实施。
