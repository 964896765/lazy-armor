# Plan 控制页 checkpoint（2026-10-07）

响应用户对计划详情信息优先级与真实语义的整改要求；沿用现有详情页，不新建 Plan/Runtime/Resource authority。

2026-10-09补充：P1/P2已CLOSED，P3仍IN_PROGRESS；本页下方为历史实现checkpoint。P4计划体验属于后续，当前只准备 [P4_PLAN_EXPERIENCE_DESIGN.md](P4_PLAN_EXPERIENCE_DESIGN.md)，未修改页面或部署。主表面转向目标、进展、现实发现与需处理事项；技术对象不作为用户流程，空读不显示“没有快递/无异常”。

## 最终承载

- 顶部短 Goal 标题、状态与摘要；完整原规则放判断依据，不修改冻结 PlanVersion 名称/定义。
- 右上操作菜单：与计划对话、编辑、运行一次、复制、合法暂停/恢复/结束。复制仅进入会话生成新 Draft，仍需用户确认。暂停/结束调用既有状态 API 并再次确认。
- 当前情况、下一步、下一次时间；cron 预计时间改用与 runtime 同一 timezone-aware parser，active Plan 优先投影 activeVersion。
- 计划内容用时间/判断/条件/执行/确认/验证表达，canonical capability 优先于 legacy publish marker。
- 待处理有才显示；读取失败明确重试，不把失败显示为无事项。
- 来源使用真实会话/历史模板记录；当前无 SkillVersion 时显示自定义或历史模板，绝不造 Official/GitHub Skill 引用。
- 信息区引用冻结 FactDemand 对应 Truth、来源、observedAt、freshness 状态；最近读取条数来自同版本 canonical VERIFIED read Ledger 所关联 acquisition。
- 资源区展示当前版本最近真实 Invocation 的目标和当次验证，历史使用不等于当前 AVAILABLE；不虚构 Google Calendar 备用目标或自动/固定配置能力。
- 最近结果中文呈现，success、Verification 与 unknown 保持独立；核实失败结果不代表创建成功。未知结果显示核对中，不鼓励重复执行。
- 最近运行列表及分页运行记录页沿用既有 executions/page → Execution 详情；有 Ledger 证据才展示验证标签。
- 判断依据保留确认规则与事实合同，展示解释摘要而非模型 Chain of Thought。
- 设置拆为时间与触发、通知、自动化与确认、计划版本；尚无通用编辑合同的自定义 Plan 通过计划会话提出版本变更。

## 数据与安全

`GET /plans/:id/control-projection` 是只读 consumer projection。先经 canonical owner 检查，选择当前运行版本；从既有 CreationContract、FactDemandResolver、Truth、Invocation、RuntimeTarget、Result Ledger、Execution、Approval、Reconciliation 读取，不 dispatch、不授权、不写 Truth。

手动运行 fail closed：计划未 active、仍有运行/审批/核对，或包含写入/发送操作时关闭菜单入口。新的 run-once 有新的 idempotency key，不能用之前 Invocation 幂等来宣称不会重复外部副作用。本批不改变底层 Risk/Approval authority。

本页是 P4 产品投影 checkpoint，不代表 P4 全部收口、Skill 平台、备用 Provider 或 P1 故障矩阵已完成。

## 验证与真实 Evidence

最终 APK 已安装 23049RAD8C，SHA256：`1A5DA68C8A88E023F89D5432566F453B1DE1B3F740E2FAF5435C1E2F0CC609CF`。真机核对短标题、菜单安全限制、上海时区下一次时间、3 条实际日历信息、真实读写资源、中文已验证结果及运行记录跳转通过；见 `artifacts/v83-plan-control-closure-phone-verified.log` 与 `v83-p0-plan-control-final-*` 截图/XML。

真实只读投影见 `artifacts/v83-plan-control-real-evidence.json`。既有 ACTIVE Plan/PlanVersion 及版本 hash 保持不变；没有为页面验收新建日历副作用。来源未绑定 SkillVersion 时保留自定义计划，不制造 Skill。

验证：全仓 typecheck 8/8；mobile 57 文件/343 项；API 既有 52 项及扩展 45 项回归通过；P1 可靠性 checkpoint 34 项通过。最终新增合同 hash 不匹配 fail-closed 后，3 文件/39 项相关 API 测试通过。隔离合同测试不替代真实运行 Evidence。

本 checkpoint 仅完成用户指定 Plan 控制页整改；P1 故障矩阵继续 Pending，P6 Registry 未开启。

最终 API build 通过并部署；部署后只读 Evidence 复核通过，ACTIVE 版本 identity/hash 未变化。
