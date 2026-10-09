# V84–V90 持续开发总方案 · V1.0

2026-10-09：按用户最新总方案进入持续开发。目标是具备感知、理解、规划、执行和验证能力的 Personal Life OS。本文为当前主线；V8.3 合同与验收历史继续保留。

## 产品与权威边界

五个一级页面永久保持 **日程 | 计划 | 会话 | 资源 | 服务**。后端与用户入口双轨开发，不新增 Agent、Memory、Skill、Runtime 或 MCP 一级页。

Goal 是入口。Planner 根据目标选择 TEMPORARY、USER_EVENT 或 PERSISTENT；长期目标才创建 Plan。生命周期与 DIRECT / COMPOSED 执行方式分开，简单事项可以使用 0 个 Skill。

Skill 是方法，Resource 是实际可读、可调用、可执行的能力，Service 是能力交付与现实履约。资源页可以说明方法所需能力与可用性；方法条目沿用计划中的 Skill 仓库，展示方法不能授予执行权。

```text
Goal → GoalExecutionContext → Intent / Planner
  → Temporary / USER_EVENT / Persistent Plan
  → 0..N Skill → Facts / Capability Requirements
  → Resolver / ResourceGap → Policy / Approval
  → Shared Runtime → Verification / Reconciliation → Truth / Result
  → 结束 / 事项生命周期 / Replan / WAIT
```

Agent Core 编排现有能力。Plan、USER_EVENT、Approval、Execution、Result Ledger 与 Truth 保留各自权威；Agent、Memory、Skill 不能直接写 Truth、发放权限或绕过 Invocation。Computer Use 与后续服务复用受控 Runtime。写入结果未知时先只读核对，不盲目重写。

## V8.3 交接

| 范围 | 主线口径 | 独立证据边界 |
| --- | --- | --- |
| P1 Persistent Plan Runtime | CLOSED | Calendar reliability 冻结 |
| P2 USER_EVENT + Multi-Authority Runtime | CLOSED | 站内提醒已验，Android OS Push 未验 |
| P3 ResourceGap 核心机制 | 主开发线已收口 | Temporary/Persistent 恢复、真实空读与来源版本/epoch fencing 已验 |
| P3 物流业务正向证明 | 独立 REAL_PENDING | 无真实京东物流通知；Candidate→Truth、Truth 发布一致性、异常 Truth→提醒→WAIT 不宣称完成 |
| 通知来源返回入口 | 已修复、构建安装 | 锁屏导致真机点按验收未完成 |

用户要求继续原定开发，业务待验不再阻塞 V84。保留旧 Task、VERIFIED_EMPTY、Ledger 和验收历史；以后真实数据使用新的采集窗口。停止重复空读与权限探针。

## 版本路线

| 版本 | 目标 | Backend / Runtime | Frontend | 关闭所需真实结果 |
| --- | --- | --- | --- | --- |
| V84 Agent Core | 理解目标并提出受控方案 | Intent、Planner、Context、Policy、可解释步骤；复用真实模型和确认权威 | 会话中的目标理解、信息/能力、资源缺口与确认 | 真实模型→合法确认→既有权威；建议不冒充执行 |
| V85 Memory System | 记住用户信息和偏好 | Profile/Preference/History/Asset/Relationship/Event；owner、来源、撤回、版本；短期与长期记忆分开 | 资源中的个人知识、编辑/删除/使用范围 | 用户可控记忆被 Planner 消费；隔离与撤回生效 |
| V86 Computer Runtime | 真实设备与网页执行 | Android Screenshot/OCR/Vision/Accessibility/Input/Notification；Browser Observe/Act/Verify；权限与单步风险门 | 设备权限/在线状态、执行确认与恢复 | 真实 App/Web 观察→执行→回读；目录不是实现证据 |
| V87 Autonomous Loop | 持续观察与跟进 | Observe→Think→Act→Verify→Learn；已有 Plan/Replan/WAIT 与受控偏好学习 | 计划进展、最近发现、下一步与反馈 | 真实变化→判断→行动→验证→等待 |
| V88 Skill Capability System | 版本化方法能力生态 | name/description/input/output/requiredResource/permission/risk/verification/version；Repository/Entry/Revision/冻结引用 | 计划中的方法仓库、详情与使用入口 | 方法组合真实资源；更新不暗改计划；Skill 不修改 Truth |
| V89 Service Marketplace | 能力交付与专业服务 | Service/Skill/Resource/Execution/Result；供给、请求、履约证据 | 发现、详情、确认、状态、结果与问题处理 | 真实请求→履约→Verification→Truth/Result |
| V90 Personal Life OS Beta | 完整生活目标管理 | 跨来源理解、记忆、规划、执行、验证、恢复和最终 gate | 五个页面构成完整产品链 | 持续真实使用闭环，未验能力与权限边界可见 |

旧 P4 Plan Detail 体验随 V84–V87 同步优化，旧 P5 Service Runtime 对应 V89，旧 P6 方法仓库对应 V88；历史合同仍有效，未实现能力不宣称完成。

## 持续执行规则

每个任务记录：任务编号、目标、背景、开发范围、Backend、Frontend、Database、Runtime、Tests、Acceptance。能力与入口双轨开发，按真实数据获取→真实执行→验证→体验→商业功能排序。

来源、时间、权限、执行与验证历史必须可追踪。自动化、构建、部署、安装与真机分别记账；缺真实数据或手机锁屏时保留待验并推进独立工作。不重复询问已确定方向，不模拟生产事实，不改历史终态，不扩大已冻结矩阵。

当前任务见 [V84 Agent Core](V84_AGENT_CORE.md)。
