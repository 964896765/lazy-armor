# 懒人装甲技术架构

当前开发依据 [V84–V90 总方案](V84_V90_ROADMAP.md)。V84 Agent Core 使用 `apps/api/src/agent` 编排/解释已校验 Planner 方案，理解合同保存在原会话消息与审计。理解阶段没有执行授权；owner/version/确认、Risk/Approval、Invocation、Ledger 与 Truth 均由已有权威控制。Memory、Computer Use、Skill 和 Service 分阶段接入同一链。

既有链路保持：Conversation/Goal→只读GoalExecutionContext→Planner判断TEMPORARY/USER_EVENT/PERSISTENT→按需0～N Skill→Facts与Capability Requirements→Resolver/ResourceGap→Risk/Approval→Invocation→Shared Durable Runtime→Target→Verification/Reconciliation→Truth/Result/Assessment/Replan/WAIT。Skill不具有执行、审批或Truth权威；正式仓库引用就绪前沿用受控Recipe，不制造平台完成证据。

系统沿用 pnpm 与 Turborepo 单仓结构。Plan、Truth、Risk、Approval、Execution、Verification 和 Audit 是权威状态链；AI、Provider、设备、MCP 与外部服务只能作为资源或执行目标参与，不能越过权威服务写入业务结果。

## 运行链路

```text
Conversation / Goal → read-only GoalExecutionContext → Planner / Router
  → Temporary Action / USER_EVENT / Persistent Plan
  → 0..N methods + Facts / Capability Requirements
  → Resolver (Resource / Service), unavailable → ResourceGap / Resume
  → controlled proposal / draft / confirmed version, Risk / Approval
  → CapabilityInvocation → Shared Durable Runtime → RuntimeTarget
  → Result / Ledger, Verification / Reconciliation → Truth
  → Result / Attention / Assessment / Replan / WAIT + Audit
```

## 应用边界

- `apps/api`：NestJS API、权威 workers、Provider、设备调度与审计。
- `apps/mobile`：Expo Router 客户端、Android 原生桥接和消费级状态展示。
- `apps/admin`：运营、证据、故障和发布管理。
- `packages/plan-schema`：计划及运行时共享合同。
- `packages/database`：Drizzle schema、append-only migration 和数据库门禁。
- `packages/connector-sdk`：资源能力与 Provider 适配合同。

## 安全边界

外部副作用必须具备幂等身份、风险判断、必要审批、执行租约、结果回读和审计记录。外部结果不确定时进入`OUTCOME_UNKNOWN`并Reconciliation，不能盲重试或切换Target重写。连接存在、获得授权与当前可执行分开；AVAILABLE依赖实现、连接、授权、userGrant、系统permission、采集状态、runtime health和fresh evidence，客户端不得自行推断。

新Target接既有Manifest/Capability/Resolver/Invocation/Runtime/Verification/Truth，不另造SkillEngine、McpExecutionEngine、ServiceWorkflowEngine、ScenarioEngine、WindowsEngine或AgentEngine。业务Skill、执行层AppSkill与资源适配器分开；候选工具提升与正式授权分开。

## API 收敛

当前移动端计划主页为 Skill仓库 / 我的计划，新建进入 `/chat?mode=plan`，已有 CreationDraft 与会话 API 仍为合法创建链。旧模板、场景与向导路由仅保留兼容；不会为更名删除历史引用。资源和服务继续从既有权威投影，不建立平行系统。


## V8.3 — Persistent Plan & Hybrid Capability Runtime

Plan = Persistent Authority；USER_EVENT = Internal Personal Event Authority；Conversation = Goal / Planner Entry；Resource = RuntimeTarget + Capability；Service = Reality Executor；Schedule = Time Projection；WorkItem = Attention / Action Projection。一级页面永久为日程/计划/会话/资源/服务，不增加Home或Runtime入口。

Shared Runtime当前已真实验证PLAN（Plan/PlanVersion）和USER_EVENT_SYNC（Frozen Sync Request）两个受控Authority Source；源版本、审批、Invocation、Execution、DeviceTask、Result与Verification保持各自职责。Persistent分支继续FactDemand→Reality/Truth→Assessment/NBA→受控执行→Verification→Replan；内部USER_EVENT提醒不因总架构图被强迫经过外部副作用链。Temporary读取继续使用其现有合法上下文，不假造Plan或新的Authority Source。概念母链不替代实际协议提交顺序。

新增 RuntimeTarget 公共 Header、Canonical Capability Identity、Invocation 和 Result Ledger 协议层。现有 TrustedDevice、Provider、MCP、ServiceProvider 保留特定状态；不复制凭据、授权或建立第二套执行引擎。Invocation、Task、Attempt、Result 分离。执行成功、结果送达、ACK、验证分别记账；采用至少一次送达、幂等、epoch fencing、验证和对账，不声称网络 Exactly Once。

领域仅为可扩展 category/tag，现有 13 领域作为首批分类；Legacy Runtime Domain 19只用于历史兼容。新 authoring 不要求用户先选 Domain/Scenario/Template；内部受控合同保留，P6 再迁移资产。AI仅生成 Proposal，不能写Truth、批准、决定来源权威性或将Executor success变成Verified。

Skill仓库最新合同：Repository（来源与commit）/ Entry（方法组件）/ EntryRevision（不可变解析与hash）/ PlanSkillReference（当前PlanVersion冻结引用）分离；Planner根据Goal按需0～N检索组合，USER_EVENT无需强制Skill。全部仓库内容是不可信输入，不能获得Truth/Approval/Runtime权威。P6实施范围见SKILL_REPOSITORY_DESIGN.md。

P4的Plan Experience Projection从现有Authority只读派生用户语义，不掌握调度/审批/Truth写权。P4～P11按Backend Capability、Product Surface、Real Evidence三轨同步，四项DoD和总Gate齐全才关闭；[Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)只统一消费表面，不成为新系统权威。
