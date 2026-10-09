# P2 Internal Schedule / USER_EVENT

2026-10-08 22:56：**P2 CLOSED / REAL_VERIFIED**。内部提醒与生命周期第一阶段证据保留；显式外部create/update/delete、来源版本隔离、真实失败恢复与重复交付验收已收口，详见[P2外部同步](P2_EXTERNAL_SYNC.md)及[32项关闭证明](../../artifacts/v83-p24-final-acceptance-reviewed.json)。P1保持CLOSED，USER_EVENT / Calendar sync可靠性线冻结。提醒交付仍限定持久化站内通知，Android OS push尚未验收。下文为各阶段历史记录。

## 权威合同

复用 `recurring_item_profiles` 个人事项权威，以 `sourceType=user_event`、`user-event.v1` metadata 区分内部事项；无新表、migration、CalendarEngine 或第二套 Plan 调度器。USER_EVENT 不创建 Plan，也不持有外部日历执行权威。

真实 Conversation / Planner 输出严格 USER_EVENT_DRAFT，用户确认后创建事项。确认以 assistant messageId 幂等，校验会话 owner、版本与最新草稿。内部草稿不能携带外部动作、capability、Scenario 或 PlanDefinition；旧 Calendar Draft 的 fail-closed 合同保留。

事项包含 title、dueAt、reminderAt、IANA timezone、version 和 active/completed/cancelled 状态。时间必须带 offset 并与时区对应，提醒不得晚于事项时间。编辑、延后、完成、取消均校验 owner 和版本，事务行锁保护并发；结束事项不能再编辑。旧提醒归档而不删除历史。移动端输入经 NFKC 规范化，拒绝 DST 缺口和歧义时间。

现有 Outbox poll 负责扫描到点事项，以事务及 FOR UPDATE SKIP LOCKED 提交站内通知和 remindedAt，避免重复提醒。复用现有 ScheduleProjection，Timeline kind 为 USER_EVENT，详情提供编辑、延后、完成、取消。

本阶段提醒交付边界是**持久化站内通知**；未实现或验收 Android OS push。

## 真机闭环

真实 AI、正式 UI 确认、自然等待到点；无数据库注入或手工 reminder tick。总验收见 [验收证明](../../artifacts/v83-p2-internal-reminder-acceptance.json)。

- 第一事项 `01a116e9-ead3-753f-ae35-3aa827a60f0b`：2026-10-07 23:16 Asia/Shanghai 到点，通知于 15:16:00.429Z 提交；到点前通知 0、到点后 1。真机延后至 23:32（v2），随后完成（v3）；实际跨过延后时间后仍仅原通知 1，已归档，没有再次提醒。
- 第二事项 `01a116f3-98f0-745a-aae1-ad7647fcf925`：真实自然语言“明天下午3点提醒我去医院”解析为 10月8日15:00。UI确认后编辑为15:30、提醒15:15（v2），再取消（v3），通知0。
- 中文 IME 将日期分隔符转为全角导致旧包编辑失败；失败样本 `v83-p2-second-edited-real.json` 保留。输入规范化修复后，新 APK 真机复验 `v83-p2-second-edited-r2-real.json` 成功，不将失败样本记为通过。

两个会话 planId 均为空。第一条正常提醒链截至23:17完成时，新 Calendar Invocation/DeviceTask 均为0。23:24另有既有独立 Plan `01a111cc-7e0b-74e9-92d6-b85e7b837c62` 自动执行 calendar.event.read；来源由冻结 PlanVersion 与 Task planWakeup 证明，非 USER_EVENT 产生，见 `v83-p2-concurrent-calendar-origin.json`。

整个验收期间新增 calendar.event.create Invocation / NATIVE_CALENDAR_CREATE task 为0。CalendarProvider `_id:title` 前后及最终快照相同，SHA256 为 `67277b98a6c8ab2470e906b232bfa6d2924f79ec3653bb29601384e3da818ab0`；该快照证明事件身份/标题无新增变化，不代表核验全部日历字段。测试事项均已完成或取消。

## 验证与部署

共享合同4项通过；最终后端回归16项（P2 integration4、新Planner7、旧Profiles5）通过；移动端时间规范化3项及已有投影/error验证通过。API typecheck/build、Mobile typecheck、APK构建通过。最新 APK 已安装真机，SHA256 `D98FC41F29247FE7E7C69785B044612D8F1BE53BC82E14401FA5CC35D23F56DA`。

关键证据：`v83-p2-user-event-final-authority.json`、`v83-p2-user-event-after-postponed-due.json`、`v83-p2-second-final-authority.json`、`v83-p2-user-event-real-schedule-projection.json`；回归日志 `v83-p2-user-event-final-regression.log`。全部位于 artifacts，历史 Evidence 保留。

## 后续边界

第二阶段已接入显式PHONE_CALENDAR同步：合法Planner/确认→USER_EVENT_SYNC→同一Resolver/Approval/Invocation/Runtime，event19真实commit-gap回查已取得Verification/Truth/独立Link。内部事项权威不变；详情见[P2_EXTERNAL_SYNC.md](P2_EXTERNAL_SYNC.md)。已真机验证延后时间修改v2/取消v3及外部仍绑定v1，真实确认/start各重放3次无新增执行。更新/删除仍只产生未授权建议，冻结变更合同已补，当前执行能力未实现。P2 整体不标 CLOSED，不进入 P3、Skill 或 Provider/MCP。


2026-10-08最新：P2 UPDATE/DELETE已在同一Shared Runtime接入服务端派生建议、冻结确认、独立审批、Native变更/lookup-only与Verification/Truth/Link。后端已部署，新APK已构建；ADB无手机连接，尚未安装或真机验收，P2仍IN_PROGRESS。旧NOT_IMPLEMENTED段落为历史checkpoint，当前准确状态CODE_IMPLEMENTED / BACKEND_DEPLOYED / REAL_PENDING。详细证据与限制见P2_EXTERNAL_SYNC.md最新checkpoint。


## 2026-10-08 22:56 P2 最终收口 — CLOSED

指定APK已真机安装；UPDATE保持event20身份、DELETE缺失Verification、permission/offline隔离、UPDATE unknown只读回查、真实签名回执/来源重放、Worker/Outbox/App重启均通过冻结验收。完成仅内部生命周期，原unknown Ledger与历史合同/证明保留。最终[32项真实复核](../../artifacts/v83-p24-final-acceptance-reviewed.json)全部通过；[完整验收与限制](P2_FINAL_ACCEPTANCE.md)记录真实UI、既有owner协议和JDWP观察的各自范围。

本轮修复UTC自动恢复查询、Drizzle包装重复签名错误500→409、completed回执重放误标CHANGE_PENDING；9项签名权威回归、7项multi-authority集成及API构建通过，修复均部署/对应真路径复验。内部提醒交付仍限定持久化站内通知，Android OS push尚未验收。USER_EVENT/Calendar sync可靠性线冻结，P1 CLOSED、P2 CLOSED；下一主线P3 ResourceGap Auto Resume，本批未开始P3实现。
