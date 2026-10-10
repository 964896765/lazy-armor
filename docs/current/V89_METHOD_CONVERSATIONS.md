# V89-SKILL-03 · 从所选方法开始目标会话

目标：让用户从已接入的方法开始表达目标，沿原 Planner、事项/计划/一次性操作确认和 Shared Runtime 继续处理；方法选择本身只建立规划上下文。

Backend：原 POST /conversations 可携带 0～3 个严格的 methodRefs，包含仓库/条目/确切 Revision、仓库 version 与内容 hash。重复条目、额外授权字段、过期/关闭/归档、错误归属或不匹配内容拒绝。创建事务锁定复核后把引用存入原 contextRefs，并追加 CONVERSATION_METHODS_SELECTED 审计。已有 draftId/planId 的恢复入口不能借此替换方法上下文。

Planner：显式选择优先于自动领域检索，保持用户顺序及确切版本；来源只进入原 UNTRUSTED_SOURCE_CONTENT。每次生成前复核所选版本，模型返回后和消息发布事务内沿原门再次复核。方法更新/关闭/归档后，原版本仍可见，新的目标消息保存并解释需要重新选择，不调用模型或悄悄替换方法。记忆、资源、事实、风险与原输出校验继续适用。

Frontend：方法仓库详情在启用规划参考后提供“用此方法开始会话”，进入已有临时会话，用户自己输入目标并决定一次处理或设为计划。会话显示原方法、声明版本、当前/已变化/不可用状态与返回仓库入口。没有新增一级页面或按钮直接启动 Task。

Database：零 SQL 迁移、零新表。原 consumer_conversations.context_refs JSON 增加 SkillMethod 类型，原 user Message 留下引用；仅 TypeScript 数据声明更新。PlanSkillReferences 继续在正式确认时写入，旧版本不回填或覆盖。

Runtime：临时会话提升为 Plan 时保留所选引用，原 Plan 确认同事务复核/冻结。ACTION_PROPOSAL 的一次性确认也冻结同一方法 Revision；方法失效时整份 ONCE Plan 创建回滚。确认重放沿原 Once request/Execution 身份，不重复方法引用或副作用；实际执行仍要求独立审批、资源核对和 Verification。

Test：隔离数据库验证 owner、关闭/归档/升级、hash/额外授权字段、重复/上限、三个方法按序组合、创建无 Plan/Execution/Truth、领域不匹配时显式参考、提示注入边界、模型/发布期间撤回、临时会话提升、正式 Plan 引用、一次性冻结/审批/重放和撤回后的事务回滚。Shared 合同验证严格引用结构与授权字段拒绝。原会话、记忆、页面读取与一次性 Runtime 回归、构建结果见 V90 最新联合记录。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED。新专项最终 11/11，最终关联 API 8 文件 73/73；首组三文件 19/19 覆盖原仓库与一次性审批（含重叠专项，不累计总数）。Mobile 全套 388/388、Plan-schema 全套 251/251、八包 typecheck、API/Web 构建和 Android Hermes export 通过。真人点按、真实第三方方法/模型/资源组合仍 REAL_PENDING；V89 和 V90 整体继续 IN_PROGRESS。进入本轮前的 12 个登录与设备 Runner 文件经 SHA256 核对原样保留，独立于本轮提交。

下一任务：所选方法所需的实际资源能力核对与缺口入口，复用原 Resolver/Permission/Health；本人实际方法→目标→合法确认→资源→验证闭环仍独立收取。
