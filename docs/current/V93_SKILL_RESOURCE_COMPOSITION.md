# V93 能力组合与资源图

2026-10-12：首批结构预览与手机入口已实现，V93 IN_PROGRESS / REAL_PENDING。组合结构通过不表示资源授权、计划已编译或操作已执行。

2026-10-12 后续：新增[受控规划交接](V93_COMPOSITION_AUTHORING_HANDOFF.md)。核对后的确切方法版本、字段映射、顺序与成果要求已能进入原持久化 AuthoringJob / Orchestrator / Planner，受理、计算和提交均核对来源；原计划/个人事项/一次性操作确认入口也复核组合来源。联合自动测试27/27。当前交接是 `PLANNING_REFERENCE`，不能冒充已执行 typed Graph 或已编译组合 Runtime Recipe；费用/时间预算、正式交付适配、实际绑定、Runtime编译与真实多方法执行恢复仍待补齐，整个V93继续IN_PROGRESS。

复用原 Skill Repository 的最多三个确切 MethodRef、GoalBrief、Conversation、GoalResourceMatch 和权限。没有新增数据库、GraphDB、Worker、Runtime、Plan 或 Execution 写入。

## 当前交付

`GET /api/conversations/:id/composition-options` 从当前账号的原会话读取确切方法版本、严格输入/输出字段及最新需求。系统只建议名称和类型匹配、来源唯一的前序输出，或同名用户声明/假设；歧义、历史来源和不支持的字段留空。方法内容及版本继续由原仓库管理。

`POST /api/conversations/:id/composition-preview` 核对目标字段、实际用户消息引用、原方法引用、当前资源观察和有界有向图。返回固定 `readOnly=true`、`executionAuthorized=false`、`runtimeRecipe=NOT_COMPILED`。最终事务再次核对原会话、方法、GoalBrief 与引用消息，拒绝规划期间被改写或撤回的来源。预览hash包含GoalBrief的内容hash和实际输入消息的id/contentHash，而非仅版本号；后续合法编译器仍需独立核对，不把客户端hash当作授权签名。

当前输入输出支持封闭对象、最多16个 primitive 字段；拒绝开放合同、外部 `$ref` 和未支持的 JSON Schema 关键字。最多32条方法映射、48条目标绑定、12项交付；必填字段必须有唯一来源，字段和类型须存在，只允许 integer→number，不推断字符串金额或数值。循环阻止组合。

资源节点保留确切方法引用和候选资源，风险取声明与实际观察最高值，未知按R4。写入/通知始终要求原合法执行方案。当前资源是带时间的观察，执行前必须再走原资源和逐项授权核对。CONFIRMED Memory/Truth 来源在撤回适配完成前阻止绑定，不能因“曾确认”而默认长期有效。

手机从原会话的“你选择的规划方法”进入“核对能力组合”。展示原目标和假设、每个输入的候选来源、成果选择、方法顺序及资源缺项。字段调整后清除旧预览；页面重回前台或刷新后重新读取上下文并清除旧结果。没有“执行组合”的按钮；原目标继续沿原方案和审批入口。

## 验证与后续

最终API联合14/14（`artifacts/v93-composition-preview-r4.log`）；共享合同全套54文件304/304（其中本版本11项），最终结构专项11/11；Mobile全套70文件428/428（其中本版本3项），最终相关展示5/5；API/Mobile类型与API构建通过。前后轮次重叠不累计。覆盖建议歧义/类型、CONFIRMED来源阻止、原仓库撤回、非法UUID、生成期间消息更改、精确来源hash和零执行权威增量。夹具只在隔离SQL/Redis测试库运行，不是手机多方法执行证据。

最终Android r3构建并保留数据安装成功，实际pull的APK及内嵌Hermes hash与构建一致，原tracked bundle恢复；见`artifacts/v93-device-install-r3.json`。本人登录和决定仍保留。当前账号没有已选方法会话，首包在真机拒绝无方法组合，但只有通用错误提示；现已修正，本人解锁后正常UI实见明确提示及“选择规划方法”入口，截图`artifacts/v91-device-v93-unlocked-r6.png`。API本地更新到最终build，PID3480；原Execution/Outbox PID19896/22660保留且ready，无新迁移；原93条ledger保留。首次API启动等待及ADB daemon失败日志保留；息屏截图不计为成功UI证据。手机缺项提示不算真实多方法执行旅程。

后续仍需：Service Recipe与正式交付适配、费用与时间预算、实际授权绑定、合法 Runtime 编译、失败补偿/核验合同、多方法真实旅程。Planner受控交接已实现，仍不关闭V93或历史第三方/长期运行验收门。
