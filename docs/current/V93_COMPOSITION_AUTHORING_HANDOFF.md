# V93 组合选择进入原方案生成

2026-10-12：`PLANNING_REFERENCE`交接实现并通过自动验证。V93仍为IN_PROGRESS / REAL_PENDING。

原组合预览没有把用户核对的字段来源、方法顺序和成果选择传给后续生成。现在 `POST /api/conversations/:id/composition-authoring` 接受有界graph与预览的不可变来源basis，服务端重新生成预览、拒绝缺项、核对确切GoalBrief/hash、方法版本和原用户消息hash，再沿原 `ConsumerService.message` 原子保存用户消息、组合快照及AuthoringJob。客户端不能提交权限、实际连接绑定或Runtime Recipe。

任务沿原队列、租约、截止时间、恢复与提交栅栏运行。Worker生成前重查组合来源、原方法及当前资源观察，并核对有向顺序和风险。Orchestrator把确切映射、成果和方法顺序传入原Planner的不可信数据区域；方法内容仍从原仓库按确切版本解析，不由客户端直接提供。生成提交在原事务中重查目标、方法、源assistant payload及用户消息hash；来源撤回时舍弃方案并保存明确原因。

相同requestId与相同选择返回原任务，完成后重试也不重复生成。改变选择复用requestId被拒绝。普通消息沿旧输入hash算法与原链运行；新组合消息在hash中加入选择hash。新快照保存于原消息及job JSON，不增加表或迁移。计划、个人事项和一次性操作原确认入口都复核组合来源，随后仍沿各自原合法创建和审批。

Mobile的「能力组合」增加「按此组合准备方案」，只在结构通过后出现；保存后按原受理响应的mode回原计划/临时目标查看后台结果，输入变更清除旧预览，失败重试保留同一请求身份。原严格Options响应合同保留，兼容原客户端。手机应用目录合并也随本包收尾，原生双标题已修正。

自动验证：隔离API组合交接10项、原预览7项及V91生成10项联合27/27；共享Graph及交接合同15/15；Mobile组合展示/接入/资源/发现联合32/32；API构建及API/Mobile类型通过。第一次联合回归23/24，失败为添加可选workContext后尚未重建共享dist导致严格options schema拒绝字段；重建共享包后最终27/27，失败日志保留。测试使用独立*_test SQL与隔离Redis，不计个人真实执行证据。

交付边界：快照始终 `kind=PLANNING_REFERENCE`、`executionAuthorized=false`、`runtimeRecipe=NOT_COMPILED`。字段映射指导方案生成，尚不保证按方法逐节点产生typed输出，报告目标现已通过[有界报告适配](V93_REPORT_DELIVERY_ADAPTER.md)进入原报告Worker，但仍非逐节点typed输出执行。资源READY是当次观察，不是实际连接或字段范围授权。已有原场景编译不能冒充通用组合Runtime编译；未新增执行器或Agent循环。

继续任务：

| 任务 | 当前状态 | 关闭条件 |
| --- | --- | --- |
| Graph结构与来源核对 | 自动验证通过 | 维持原版本与撤回门 |
| 原持久化Planner交接 | 自动验证通过 | 补真实多方法手机生成旅程 |
| 官方Delivery/Service Recipe适配 | 有界报告指导适配已实现，其余待开发 | 精确输入输出、交付验收及不支持能力明确阻止 |
| 时间与费用预算 | 报告截止/调用/输出预留已实现；人民币计价待开发 | 总任务预算、超限与取消有实测证据 |
| 实际资源绑定与Runtime编译 | 报告公开连接固定绑定已实现；字段范围/Runtime仍待 | 原版本/逐项权限/Plan确认/审批无旁路 |
| 补偿、未知结果与恢复 | 待开发 | 沿原Verification/Reconciliation，不重复副作用 |
| 真实多方法＋实际资源闭环 | 待验 | 真生成、原执行、验收和恢复可追溯 |

最终复核保持原Options响应，联合API再次27/27（`artifacts/v93-handoff-integration-r3.log`）；API最终构建r2、Mobile最终类型r2及Android/Hermes r2通过。新包保留数据安装，实际APK及内嵌Hermes hash一致，原tracked bundle和12个独立文件保留。手机已验证应用目录收拢与兼容路由；这不计多方法生成或执行证据。

原确认权威兼容回归另外28/28（5文件：一次性操作、个人事项、方法会话、需求确认及临时目标转计划），见`artifacts/v93-handoff-original-authorities-r1.log`。含原独立审批、持久化效果与核验，不由新组合接口直接执行；仍全部为隔离fixture验证，不计个人实际资源验收。

本地只读确认零活动Authoring/Report/Execution后，更新原API（PID18064）及Execution/Authoring Worker（PID21524），原Outbox（PID22660）保留，三角色ready通过。93条migration ledger保持，没有新SQL。该账号的实际多方法组合生成仍待本人从原方法仓库选择，未在个人库植入测试方法或fixture。

私有证据：`artifacts/v93-handoff-integration-r3.log`、`artifacts/v93-handoff-schema-tests-r1.log`、`artifacts/v93-handoff-mobile-regression-r1.log`、`artifacts/v93-handoff-api-build-r2.log`、`artifacts/v93-handoff-mobile-typecheck-r2.log`、`artifacts/v93-handoff-install-r2.json`、`artifacts/v93-handoff-services-r1.json`。未提交、推送或生产发布。
