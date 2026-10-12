# V92 决策、反馈与受控学习

2026-10-12：首批代码与隔离自动验证完成，本人旅程仍待验。复用原 Memory、Planner、Runtime、Verification 和 Audit；不新增执行器，不建立另一套永久记忆。

## 已接通的两条路径

报告 → 本人选择、理由、预期 → 明确确认 → 原 PersonalMemory 的 DECISION → 后续目标理解。决策绑定原 Conversation、报告 Message、report revision/hash 和可用的 GoalBrief 版本。完成报告只证明交付，不证明市场事实、经营结果或预期已实现；个人反馈与核验结果分别标记。报告页显示本人决策历史，支持分页、来源核对、更正和删除。当前历史选择可能有多个；Planner 要核对时间和适用范围，冲突时询问，不能由历史决定自动执行。

连接服务的已核验计划操作 → 经验候选 → 本人确认/忽略 → 原 PersonalMemory 的 HISTORY → 下次规划参考。候选由系统从原证据确定性整理，不额外调用模型，也不从 AI 报告正文提取用户事实。当前按用户点击整理最近 30 天最多 50 条证据，每个证据只产生一条建议。

候选仅是单次历史结果，样本数为 1，保存后有效期不超过核验日起 30 天。SUCCEEDED、FAILED、PARTIALLY_SUCCEEDED 分开保留；OUTCOME_UNKNOWN、无证据、来源不匹配不生成经验。部分结果使用原已闭合 Reconciliation；旧 Execution/Operation 的失败或未知状态保留，不改历史以制造成功。本人反馈是个人判断，不能改变核验结论或成为永久偏好。

## 权威与撤回

新 `learning_candidates` 表只保存审阅元数据。确认仍调用原 Memory 保存路径、原使用开关、owner 隔离、CAS、幂等、引用和 Audit。新增 API 均在原 `/api/memory` 下；没有新 Truth、Plan 或 Execution 写入。报告决策直接使用现有 `personal_memories.source_ref_json`，没有决策数据库。

经验来源核对 operation/step/execution/plan version、定义 hash、请求 hash、输入指纹、action intent、最新 evidence、原策略 hash、证据 hash、Reconciliation 身份、连接和逐项授权。兼容旧操作只保存 connectionId 而 connectorId 为空的原合法情况；Connector 从原 Connection 派生。授权撤销、过期或授权时间变化使旧经验停止检索；重新授权不会恢复旧授权时期的经验。

关闭使用使待审经验失效并清除文本/来源快照，再开启不复活。忽略同样清除候选内容；下一次整理清理已过期待审内容。删除已保存记忆清除正文及经验来源快照，只留幂等 tombstone。关闭开关不删除本人已经保存的信息。

Planner 前检及 Consumer 最终提交事务均核对来源、使用设置和引用版本；更正、删除、关闭或来源变化后，正在生成的答案不能继续引用旧记忆。Memory 关联也不能绕过来源失效检查。检索先做相关性筛选，仅核对实际种子及包含的关联节点，最多使用 8 条记忆。

本人更正经验或报告决定后，新版本标为 USER_INPUT 并解除旧结果/报告标记；个人改写不能继续冒充原验证结论。方法优化和授权策略没有自动修改入口。

## 验证证据

| 证据 | 结果与实际范围 |
| --- | --- |
| `artifacts/v92-final-memory-r8.log` | 5 文件 36/36：新增经验 9、决策 6 与原 Memory/提取/关联回归；隔离 SQL、Redis 与确定性模型 |
| `artifacts/v92-decisions-runtime-r7.log` | 4 文件 30/30，包含原 Runtime 网络中断/查询核实及 V92 联合；与上项重叠，不累计 |
| 共享合同全套 | 53 文件 293/293，含新学习及决策合同 6 项 |
| Mobile 全套 | 69 文件 425/425；展示不会把失败、部分成功或未知标为成功 |
| 类型/构建 | API typecheck/build、Mobile typecheck 通过；V92 Android 构建、保留数据安装及实际 APK/Hermes 一致性核对完成，见 `artifacts/v92-device-package-r1.json`、`artifacts/v92-device-install-r1.json` |

早期失败日志保留：测试夹具先补原执行权威形状、合法状态和消息 contextRefs；没有放宽 Runtime 数据库约束。原链联合发现旧 Connector ID 可为空后，沿原 Connection 解析，最终原 Runtime 专项 9/9。网络服务是本机隔离夹具，即使经历真实 TCP 中断，也不算第三方或真机证据。

## 本地准备与范围

只应用增量 `0092_learning_candidates` 到本地开发库前，完成无活动 job/lease/report 检查和 26,482,246 字节私有 SQL 备份；原 92 条迁移 ledger 完全保留。`artifacts/v92-device-local-additive-r1.json` 和 `artifacts/v92-device-services-r1.json` 记录增量与原三个角色恢复。备份未上传，未宣称恢复演练通过。

12 个独立登录/Runner 文件按 `artifacts/v88-loop-r3-preexisting-hashes.json` 核对不变。没有提交、推送或生产发布。历史 0083 正式发布检查仍要求单独的 release evidence；本次新增表不关闭该门。

当前首批经验适配只覆盖连接服务的 Plan 操作及其原 VerificationEvidence；原生设备、USER_EVENT_SYNC、只读 RuntimeResult 和本地通知历史尚未接入，缺少相应权威适配时不生成假经验。多样本分析、预测与实际指标对比、候选自动后台收集、方法优化新 Revision、跨领域体验及真实长期运行仍待深化。

本人已在手机开启 Memory 使用，正常 UI 核对开关生效。按本人“你来填写”的要求，通过正常 UI 填写洗车店调研决定、理由及预期，随后本人回复“已核对并亲自确认保存”。App已进入“个人信息与来源”，只读本地数据库核对同报告只有一条ACTIVE DECISION v1，来源为REPORT_DECISION_CONFIRMED，原报告revision5/hash及GoalBrief version3完全一致，sourceCurrent=true。证据 `artifacts/v92-device-decision-evidence-r1.json` 与 `artifacts/v91-device-v92-decision-saved-r1.png`。

继续沿正常手机原会话发送“请参考我已保存的洗车店调研决定，列出需要核实的事项；不要启动计划或执行操作”。原持久化任务一次完成，result=ANSWER，391字正文列出租金、竞争门店、排水合规、车流及人工成本，并保留市场与资料状态的不确定性；新消息保存同一Memory id/version1/settingsVersion1引用。手机显示“这次理解参考了你确认保存的个人信息”，点击该来源回到同一决定及原报告入口。证据 `artifacts/v92-device-decision-followup-r1.json`、`artifacts/v91-device-v92-followup-answer-r1.png`、`artifacts/v91-device-v92-followup-reference-r1.png`。这是实际配置模型和正常UI的保存→后续理解→来源找回子闭环，正文的市场判断没有独立核实。真实经验接受及更广结果适配仍待验，V92全版保持IN_PROGRESS。独立后续工作继续V93，沿原三个方法、固定Revision及资源/审批合同。
