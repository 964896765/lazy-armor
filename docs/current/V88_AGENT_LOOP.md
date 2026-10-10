# V88 Agent Loop

2026-10-11 持续目标：[V88-GITHUB-01 / V88-LOOP-04](V88_GITHUB_DAILY_DIGEST.md)。本人已确认公开 Trending 日榜、所有语言、前 10；每日北京时间 09:00 自动读取、生成提示词/摘要与站内结果，沿原 Plan/Execution/Worker，新增 owner-only 最近七天记录统计。专项与回归 30/30，启动版本核对增量 8/8；公网十项探针仅为诊断。GitHub 新范围授权、草稿启动、首次真实运行与七个日期待验，不将统计或隔离未来日期当连续证明，保持 IN_PROGRESS。

2026-10-10 最新真机资料报告：[V88-REPORT-02](V88_REPORT_WEB_RESEARCH.md)已沿本人在 App 授予的荆门官网范围完成自动提示词（2211 字符）→两条查询→三篇实际官网原文→7783 字符报告与程序计算→一次修订/检查→App 查看。正文引用两篇有限城管/营商背景，另一篇保留未采用；必应当前不可用，明确标注实际网站入口发现。原文 URL、页面日期、读取时间、正文哈希和逐次授权均保留；本地车量、租金和产能仍未核实。只读验收 14/14，最新授权专项 7/7（含正文不足后继续有效来源），原无来源报告和两次 FAILED 均未改写；新增搜索词与选源一致性、无原文不冒充完成、资源检查后范围恢复。零新 SQL/Truth、提交、推送或生产发布；V88 七天、V87 外部 Act、V89 实际第三方、V90 联合验收、0083 发布门及原依赖审计问题仍保留。

2026-10-10 最新真机自主报告：[V88-REPORT-01](V88_AUTONOMOUS_REPORT.md)已通过正常 App 原会话完成荆门洗车店目标 → 1799 字符自动提示词 → 四章 / 7711 字符完整报告 → 程序三情景计算 → 模型检查 → App 查看。离开页面后后台继续完成，六项检查建议保留，五次历史失败未改写。本轮最终 API 26/26、共享合同 258/258、八包 typecheck 和构建通过，原 Mobile 416/416 与已安装界面保持。本次为明确假设稿，未接入任意网站检索或核实当地市场；零新迁移、Truth写入、提交、推送或生产发布。V88 七天、V87 外部 Act、V90 联合验收与 0083 发布门仍待验。

2026-10-10 最新真机闭环：[V87-COMPUTER-04](V87_REAL_OBSERVE.md)通过正常原会话、新范围确认和签名 DeviceTask 实际读取计算器结果 = 36,000,000,000；本人在 App 核实，精确候选→observation→Truth version→provenance 哈希一致，原会话已回显核实结果。原 FAILED / NEEDS_CONFIRMATION 及首次失败记录保留。新增权限返回刷新修复已 typecheck、Mobile 416/416 与 Android 构建验证并保留数据安装，安装 APK hash 与构建一致。真实 Observe 子闭环完成；V87 Act/read-back、V88 七天、V89 第三方、V90 联合验收及 0083 发布门继续待验。无新迁移、提交、推送或发布。

2026-10-10 最新续接：[V88-LOOP-03 核实结论与逐次历史](V88_LOOP_REFLECTION.md)补齐已确认部分成功/失败的只读状态、其余未完成步骤检查、按 Invocation 去重计数和分页历史 Reflection。最新结果与原 Execution/UNKNOWN Ledger 分别保留；无新 SQL 或执行入口。最终 API 48/48、Mobile 416/416、Plan-schema 252/252 与构建通过。原三角色已恢复实际 ready；本人告知真机登录，本人已完成应用内页面读取、Android observer 与使用情况访问授权；首次单次读取受验收 UIAutomator 干扰而 FAILED，原记录保留，真实读取和本人核实仍待复测，七天实际证据继续待验，V88 IN_PROGRESS。

2026-10-10 V90-BETA-02 联合验证补充：LoopPageDto 在覆盖 limit 上限时显式保留可选、数值转换、整数、下限 1 与上限 20 校验。列表与 history 对 0、负数、小数和 21 均返回 400，合法 20 返回 200；关联 API 6 文件 50/50 通过。没有改变运行或历史权威，七天实际证据仍待验，见 [五页联合记录](V90_BETA_JOURNEY.md)。

任务编号：V88-LOOP-01。

目标：让用户看见已有持续 Plan 的观察、运行、审批、核实、未知结果核对与等待状态，并读取本次运行的反思依据。

背景：2026-10-10 用户再次要求按 V84→V90 连续开发。V84 Task、V85 Memory、V86 Resource 与 V87 只读观察代码已有实现；V87 本人系统授权/真实观察仍独立待验。本轮在既有运行能力上推进可独立验证的 Loop 产品与合同，不开放未经真机验收的 Act，也不把前序阶段关闭。

Backend：新增 owner-only `GET /agent/loops?limit&cursor` 和 `GET /plans/:id/agent-loop`。列表使用稳定游标，上限 20；只包含持续 Plan，排除 ONCE、草案与已归档计划。单计划保留冻结的已应用版本，新草稿不能替换运行中的版本、标题或反思。计划暂停/结束优先于历史运行状态。

Frontend：日程今天的未完成视图新增“AI 正在关注”，展示实际计划、资源恢复、等待确认、运行、结果核实与下次检查；卡片回原计划。分页后的更多入口回原计划列表。无登录不读取，失败提示重试，不用失败响应冒充空列表。五个一级页面不变。

Database：零新 Loop 表。读取原 Plan/PlanVersion、Trigger、Execution、Approval、Invocation/Result、Reconciliation/Verification 和原通知来源投影。读取接口不创建 Task、证据、权限或 Truth，不改变历史终态。

Runtime：原 `TerminalHandoffService` / `PersistentNotificationPlanService` / Execution Worker 继续拥有定时、事实变化、资源恢复、Plan→Task→Act→Verify→重评估→WAIT。Loop Manager 是这些权威的只读入口；没有第二个定时器或绕过审批的执行入口。

Reflection：按实际 Invocation 左连接 Result，缺少任一结果不能显示已核实；执行器成功且没有 durable Result 显示待核实。未知结果保持 RECONCILING，不能因重试或成功旧结果消失。已核对的新证据必须匹配原 Reconciliation Case、Operation、ExecutionStep/ActionIntent；原 UNKNOWN/FAILED 记录不回写。反思展示的是历史结果，不能证明当前页面或资源仍有效。

核对完成后的状态以匹配的正式证据为准：全部 Invocation 已核实且没有未结 Case 时可以回到 WAITING，旧 Execution 的 OUTCOME_UNKNOWN errorCode 不再让界面永久显示核对中。原失败执行、未知结果 Ledger 和冻结 PlanVersion 保留；只读投影不修改运行历史。

Test：Plan owner、分页边界、只读入口、执行器成功与核实分离、UNKNOWN、暂停、新草稿与已应用版本隔离。另检查 Task、Memory、V84 确认及 V87 原目标读取回归；证据见本轮 [联合记录](V90_BETA_ACCEPTANCE.md)。首次测试试图修改终态隔离 fixture 被原数据库不可变门拒绝；修正为新运行经原 StateService 进入 UNKNOWN，未改门禁。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED。V88 整体 IN_PROGRESS；连续真实运行 7 天尚未取得证据。日程卡片和测试不是七天验收，也不证明新的 Computer Act 能力。

下一任务：原合法目标与真实资源下收集持续运行、等待、恢复和核实的时间序列；V87 Observe/Act/Verify 与 V88 七天证据分别记账。等待真人依赖时继续可独立验证的 Skill 与五页集成代码。

V88-LOOP-02：新增 owner/version-scoped GET /plans/:id/agent-loop/history。复用实际 Execution 和已提交的通知/定时 Plan WAIT/ResultReevaluated 审计，以时间与 ID 合并分页；每页最多 20，仅当前运行版本。输出最小状态/时间/执行引用，不暴露原输入、屏幕内容、Truth 值或完整审计。计划判断依据增加“持续运行记录”二级入口。原成功、失败、未知结果与等待分别保留；历史列表不是七天连续现实验收证明。
