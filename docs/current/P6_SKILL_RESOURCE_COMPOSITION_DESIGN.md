# P6 Skill + Resource 组合 — 设计准备

2026-10-09：DESIGN_ONLY。P1/P2 CLOSED，P3 IN_PROGRESS；P6 是后续阶段，本批只准备设计。既有 [SkillRepository / Entry / Revision 基线](SKILL_REPOSITORY_DESIGN.md)继续有效，未实现的平台与引用不被记为已完成。

按最新 [前后端一体化总计划](V83_MAINLINE.md)，P6后台平台与计划/会话产品表面同步推进，并遵循 [Mobile Product System Track](MOBILE_PRODUCT_SYSTEM_TRACK.md)。来源范围包含Official、GitHub、URL、Upload、Community与User-created，仍按现有V1/V2/V3分步完成，不把首条方法闭环当作全部来源已实现。

## Skill 的产品定义

Skill 是解决问题的方法：说明接受什么材料、怎样理解和判断、需要哪些事实或执行能力、形成什么候选或方案，以及适用条件和局限。它可以包含受控步骤与规则，但不强迫每个 Goal 都采用同一固定流程或生命周期。

用户先提出 Goal。Planner 先判断它是 Temporary Action、USER_EVENT 还是 Persistent Plan，再按需检索并组合 0～N 个 SkillEntry。没有合适方法时，仍可走现有受控直达路径或说明能力缺口。

| 维度 | 回答的问题 | 权威边界 |
| --- | --- | --- |
| Goal / 生命周期 | 用户想做什么，需要一次完成、记住事项还是长期跟进 | 用户确认的事项/目标及正式版本 |
| Skill | 怎样理解和处理 | 提供方法、候选或受控方案；不授予执行/事实权限 |
| Resource / Service | 谁现在具备所需能力 | Resolver 依据真实连接、授权、健康与新鲜证据选择 |
| Runtime | 如何耐久执行获授权的动作 | 复用 Shared Runtime、Invocation、交付/恢复合同 |
| Truth | 什么现实状态已经得到可信确认 | 既有 Candidate 核实、Reality/Truth Authority |

调用工具的 schema、App 安装记录或方法文本不等于可用资源；规则判断输出也不自动成为 Truth。

## 仓库模型与方法合同

继续使用 SkillRepository → SkillEntry → 不可变 SkillEntryRevision。仓库是来源/集合，Entry 是具体方法；仓库 commit 和单个 EntryRevision 分开记录。Planner 的候选检索不等于已冻结的运行引用，用户确认后才能固定所采用的方法及相关版本。

下列是方法合同需要表达的语义，不是本批新增数据库或 API schema：

| 合同内容 | 示例或要求 |
| --- | --- |
| 名称、目的与适用条件 | Shipment Intelligence；理解授权通知中的物流线索 |
| 输入合同 | 授权且受控的材料类型、来源范围、观察时间、证据引用 |
| 所需事实 | 已知物流状态或用户约束；未知项明确缺失 |
| 所需能力 | 通知读取等 canonical capability requirement，不固定虚构 Target |
| 处理方法 | 平台识别、状态提取、异常候选规则、歧义处理 |
| 输出合同 | Candidate、解释摘要或 Action Proposal；输出边界明确 |
| 风险与确认要求 | 候选核实、外部写入/发布等交给既有 Policy/Approval |
| 兼容性与失败行为 | 无数据、材料不足、资源不可用、事实失效时如何受控等待 |
| 来源与版本证据 | Repository、EntryRevision、内容 hash、许可与兼容性评估 |

方法更新不得更改运行中的确认版本。一个 Plan 可以采用多个方法，也可以不采用 Skill；“从方法开始会话”不等于点击后直接创建 Plan。

## 三个方法示例

| 方法 | 输入与必要资源 | 处理 | 输出与限制 |
| --- | --- | --- | --- |
| Shipment Intelligence | 已授权的通知材料/最小化线索；Notification Reader | 识别平台、提取状态、提出异常候选和待核实项 | Shipment Candidate；经核实形成 Truth 后才供异常 Assessment 使用 |
| Bill Understanding | 已授权的账单材料；未来通知/SMS等读取能力 | 提取金额、时间、类别、歧义项 | Bill Candidate；核实后由现有 Truth Authority 建立事实 |
| Content Distribution | 用户提供的视频/素材及明确目标平台；相应执行能力 | 提出标题、标签和平台适配方案 | 发布 Proposed Action；独立确认/审批后才可经 Runtime 发布 |

后两项只是设计示例，不启动 SMS、发布 Provider 或其它资源开发。当前 P3 的既有 notification recipe/normalizer 不被改名为已实现的 SkillEntry；正式 Skill 版本、检索与组合需要在 P6 自己完成验收。

通知输入不意味着把手机正文默认上传到仓库、Planner 或模型。沿用当前端侧短暂处理和最小化证据规则；Skill 的能力需求不扩大采集范围、时间窗口或账号授权。方法需要额外材料时必须产生可解释的受控需求。

## 组合路径与结果权威

设计路径为 Goal → Planner 生命周期判断 → 0～N Entry 检索与组合 → Facts / Capability Requirements → Resolver → Proposed Action 或 Plan Draft → 合法确认/审批 → Shared Runtime → Reality/Verification → Truth/Result。

长期通知目标采用这样的闭环：

```text
Goal：持续关注已核实的快递异常
      ↓
Persistent Plan Draft
      + Shipment Intelligence 方法引用
      + 实际可用的京东通知来源
      ↓
用户确认，冻结 PlanVersion 与采用的方法版本
      ↓
受控通知读取 → Observation / Candidate
      ↓
用户核实 → Shipment Truth
      ↓
依已确认规则 Assessment
      ↓
需要行动时，经现有政策执行并验证
      ↓
站内提醒 / Result → Replan → WAIT
```

原材料只足以形成线索时不能给它虚构订单/运单身份；普通状态不能为了演示转成异常。发布和提醒前继续检查当前来源许可、sourceVersion/epoch 及确切 Truth 版本/撤回状态。

资源不足沿用 ResourceGap，恢复原 Goal/Plan 后重新 Resolver，而不是创建新 Plan 或获得新授权。动作结果不确定沿用 OUTCOME_UNKNOWN → Reconciliation；方法文本不能指示系统盲目重复副作用。Plan 与 USER_EVENT_SYNC 继续共用现有 Runtime，Skill 不成为新的执行来源权威。

## 产品入口与后续实现边界

五个一级页面不变。计划页里的“Skill仓库”展示仓库/方法，方法详情解释用途、需要的信息与资源、输出和来源版本；用户可把方法用于当前需求或开始会话。“我的计划”展示已经确认的长期目标，资源页展示当前真实数字能力。

P6 开发时先完成一个真实方法从检索、资源解析、合法确认到结果/Truth的组合闭环，再扩充平台。正式 Repository/Entry/Revision、引用和旧资产迁移仍按既有 P6 基线分步实现；不能用硬编码方法卡片或模拟 Skill 引用冒充平台完成。

当前 P3 只等待其三个真实 Truth 闭环，P4/P5/P6 都属于后续阶段。本文不改变 P3 DoD，不增加 App、接口或资源类型，不生成生产 Plan、Candidate、Truth 或 Runtime 对象。
