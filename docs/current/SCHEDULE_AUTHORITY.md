# 日程权威与外部日历边界

2026-10-07 用户确认的产品约束。

日程属于懒人装甲；外部日历只是资源。沿用已有 ScheduleProjection，不新增 CalendarEngine，也不建立第二套调度器。

## 权威与投影

| 来源语义 | 权威 | 日程职责 |
| --- | --- | --- |
| PLAN_TRIGGER | Plan / 当前有效 PlanVersion / 既有 Trigger、Schedule | 显示下一次运行；不能复制事件反向控制 Plan |
| USER_EVENT | 既有 recurring_item_profiles 的 user_event 合同（第一阶段已真机验收） | 展示一次性事项；默认不写外部日历 |
| ATTENTION | Approval / 既有待处理记录 | 展示需要用户处理与原详情入口 |
| SERVICE_REQUEST | ServiceRequest | 展示预约、履约、等待与现实确认 |
| DEADLINE / FOLLOW_UP | 既有提醒或 Plan 的对应合同 | 显示期限、复查；不创造新的执行 authority |
| RESULT | Execution / RuntimeResult / Verification | 展示真实结果；不把成功响应直接当作已验证 |
| EXTERNAL_CALENDAR | 外部采集经 Reality / Truth 验证的数据 | 只引用来源、对象身份与 Truth；不成为内部调度数据库 |

上述来源语义是收口设计，不表示八种对象及入口均已实现。现有 TimelineItem.kind 保持兼容，后续投影合同应区分来源语义与页面展示类型。

## 当前已有实现

- ConsumerService.timeline 汇总执行、服务请求、已验证 CalendarEvent Truth、active Plan 的下一次预计运行、待处理、RecurringItem 提醒和会话结果。
- CalendarProjectionService 对已有 timeline 做日期分组，明确没有执行权威。
- 移动端 scheduleRows 合并日程、待处理和业务动态；系统安全通知不进入业务动态。
- 独立 USER_EVENT 创建、到点站内提醒、延后、完成、编辑/取消已真机验收，见 P2_USER_EVENT.md；可选外部同步和 Android OS push 尚未实现/验收。

## 默认行为

“明天下午三点提醒我去医院”应进入内部事项/提醒合同，不自动加入 calendar.event.read/create 需求。缺少合法内部 authoring 合同时 fail closed，不能偷偷降级成 Android 日历写入。

“同时加到手机日历”才产生外部 calendar.event.create 需求，经既有 Resolver、Invocation、Risk/Approval、Executor、read-back Verification 与 Ledger。内部事项与外部事件关联身份及同步状态，不共享执行权威；外部不可用不得冒充同步成功。

需要根据当天外部安排作决策的 Plan，可以显式要求 calendar.event.read，经 FactDemand / Truth 消费。不得让所有 Plan 默认先读手机日历。

## 验收与开发边界

P1 已 CLOSED，Calendar reliability 验收线冻结。它验证 Persistent Plan 对真实外部目标执行副作用，并非内部日程实现；event18、原 OUTCOME_UNKNOWN Ledger、后续 Verification/Truth 与 next WAIT 等全部证据保持不变。

后续内部事项实现必须复用既有提醒/事项 authority；先确定单次事项生命周期、owner isolation、幂等及时间语义，再接 UI，不先建平行 Calendar Engine。验收至少证明：内部提醒不创建外部 Invocation；显式同步才走审批；Plan 暂停/换版本按原权威更新投影；外部 Truth 不回写 Plan trigger；日期与时区正确。

附件 Skill仓库内容作为 P6 设计基线：业务 Skill 引用进入计划 authoring，执行 AppSkill 留在资源。它不授权本轮提前开展 GitHub Skill 安装或执行。
