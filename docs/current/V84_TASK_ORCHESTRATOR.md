# V84 Task Orchestrator Foundation

任务编号：V84-TASK-01（用户最新 Task Orchestrator 首个提交；早期 V84.1/84.2 理解与时间上下文编号保留历史）。

目标：为已确认来源的每次运行持久化任务图，让用户在计划中看到任务进度。Task 组织工作，现有 Shared Runtime 保留执行权威。

背景：Runtime 已有优先队列、并发 worker、步骤顺序、审批、受控重试、租约恢复与结果核对；这些机制直接复用。

Backend：新增 `agent/tasks`。合法 dispatch 同事务创建一个 TaskGraph、一个主 Task 和按冻结 ExecutionStep 顺序关联的子 Task。依赖引用前一个实际步骤，唯一键阻止重复图/步骤身份。运行和步骤转换在既有 owner fence 后同事务更新 Task 快照；旧运行不由读取接口补造 Task。

Frontend：计划详情新增“任务进度”，显示每次运行、步骤、等待审批/依赖/恢复、重试次数与结果。较早版本和暂停状态明确展示，未知结果不显示完成。页面使用有可见返回按钮的 EditorPage，不增加一级页。

Database：0086 只新增 `agent_task_graphs` / `agent_tasks`，Plan/PlanVersion 可以为空以支持 USER_EVENT_SYNC。Task 包含 parent、depends_on、priority、retry_count、resource_lock。resource_lock 引用现有 Execution lease，首版不声称跨资源互斥。状态 CREATED/READY/RUNNING/WAITING/SUCCESS/FAILED/UNKNOWN，补 CANCELLED 表达取消。

接口：owner-only `GET /plans/:id/task-graphs?limit&cursor` 与 `GET /task-graphs/:id`。只有读取入口，客户端不能制造执行图、提交状态或凭 Task 授权执行。

Runtime：Scheduler 接口委托原 QueueService；新运行和队列恢复使用相同 admission、jobId、backpressure。不同 Execution 继续由现有 concurrency=4 worker 并发，同一图的步骤沿原 Runner 顺序执行。审批、重试与计划暂停/恢复沿原入口；首版不提供任意 DAG 并行或强行打断在途副作用。

UNKNOWN：Scheduler 拒绝结果未知的任务重发。终态 Task 快照不复活；lookup-only Reconciliation 的新证据仅影响只读当前状态。响应区分 `recordedStatus` 和当前 `status`，不重写旧 Execution、Task、Ledger 或 Verification。

Tests：隔离 MySQL 的事务回滚、并发确认重放、owner 隔离、分页、并发运行、旧 holder fencing、队列恢复、UNKNOWN 禁止重发、冻结版本/暂停；原 USER_EVENT_SYNC UPDATE reconciliation 回归增加 Task 当前结果与历史 UNKNOWN 分离检查。Mobile 覆盖 skipped/unknown/approval/dependency/retry 表达。

Acceptance：构建、隔离回归、部署和真机分别记录。真实手机需正常登录后，在计划详情查看新运行任务进度与返回导航；不绕过登录，不以集成 fixture 宣称 REAL_VERIFIED。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / REAL_UI_PENDING。8 项 Task 隔离数据库集成、14 项关联多来源/Authority/dispatch 回归、6 项移动端检查通过。API build、API/Mobile 类型检查、Database/Plan-schema build、87 个迁移分段检查通过。0086 已在隔离测试库执行。

全库 migration:safety 扫描仍因历史 0083 的 destructive release evidence 缺失失败；新 0086 为新增表，未修改历史迁移或豁免该 gate。真实手机登录暂不可用，界面确认与实际任务进度保留待验，V84 整体仍 IN_PROGRESS。

下一任务：V85-MEMORY-01，用户可控 Memory Store、资源页入口与 Planner 只读消费。顺序固定为 V85 Memory → V86 Resource Capability → V87 Computer Runtime → V88 Agent Loop → V89 Skill → V90 Beta。

运行底座补充回归：49/49 PASS（Task 8 + Execution 33 + Verification/Reconciliation 8），使用隔离 `_test` MySQL 与 Redis database 15。首次补跑共用开发 Redis 时，两项 job 存在断言受到正在运行的独立 worker 消费影响；保留失败日志，隔离队列重跑后全部通过，不停止正式 worker，不放宽断言。
