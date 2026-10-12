# V91 目标理解、持久化调度与用户体验

日期：2026-10-12。任务：V91-01 / V91-T01。状态：首个荆门报告切片代码、自动验证与真机/本人体验闭环REAL_VERIFIED；V91深化项与生产发布仍待后续。

依据：[Personal Life OS 整合方案 V2.0](PERSONAL_LIFE_OS_MASTER_PLAN_V2.md)。首个切片按用户选择先完成代码与自动验证；随后用户连接手机，V91-T01已备份并迁移本地开发库、安装新包，正在正常入口验收，见[真机记录](V91_DEVICE_JOURNEY.md)。未做生产发布。V92–V96仍按方案顺序推进。

## 本轮交付

| 范围 | 实现与边界 |
| --- | --- |
| Backend | RequirementsService 将原请求编译成 goal-brief.v1；OrchestratorService 协调原 AgentPlanner；AuthoringJobsService 持久化计算并由原 execution-worker 角色承载。所有生成结果均不授予执行或 Truth 权限。 |
| Frontend | 原五个导航保留。日程增加“我的目标”“最近成果”和原 WorkItem 的下一步；会话展示需求、来源状态、假设和未知项；后台需求计算可取消；报告从目标卡直接找回。 |
| Database | additive 0091增加creation_drafts.goal_brief_json、plan_goal_briefs、authoring_jobs。初期仅迁移专用测试库；V91-T01在备份后应用现有本地开发库，原91条ledger保留。未触及生产库。 |
| Runtime integration | PlanVersion、Risk、Approval、Invocation、Execution、Verification、Truth 继续由原入口控制。原报告阶段与恢复机制保留，AuthoringJob 只管理输入到建议或报告受理的计算。 |
| Test | 新合同、原 API 与真实隔离 SQL/Redis 联合验证，另完成相关原链回归、全套 Mobile/Plan-schema、本地八包类型检查与构建。 |
| Real Evidence | 隔离真实DeepSeek与V91真机/授权官网报告均已验收；App自主提示词、正文、预算修订、重启找回、取消/继续及本人查看有独立证据。前序荆门官网报告和计算器证据保持历史身份，不代替V91新链。 |

### 需求与协调

- GoalBrief 保留当前用户原话、会话版本、字段来源、成功标准、假设、未知项和准备状态；USER_STATED、CONFIRMED、ASSUMPTION、UNKNOWN 分开，声明不自动写 Truth。
- 模糊“我想创业”先补项目范围，不调用模型或创建 Plan。具体报告可在明确假设下继续，未知预算不写成零预算或凭空填写。
- 后续预算更正继承原项目；显式切换旅行或餐饮清除旧项目条件。报告使用有来源的 reportSubject，避免历史洗车关键词把新报告套成洗车财务模型。
- 原 Planner 接收有大小上限的需求数据摘要；报告接收持久化 GoalBrief 和最多 8 条用户消息摘录，每条 1000 字符并标明截断。当前更正优先，历史只用于恢复未改变的条件，不成为系统指令或许可。
- 原 CreationDraft 严格目标合同与 hash 保留。确认时核对需求 hash、会话版本、消息摘录、Memory/Truth 来源和 PlanVersion owner；新增 sidecar 固定到原 PlanVersion。旧无 GoalBrief 草案继续走原合同。
- 临时 PLAN_DRAFT 提升为计划时，同事务推进会话/Brief 版本并写入新草稿，随后沿原确认冻结；归档、陈旧 Brief、他人访问及旧版本拒绝且回滚。

### 可恢复计算

输入、占位结果、PROCESSING 标记与 AuthoringJob 同事务提交。请求 ID 与输入 hash 保持身份；入队失败保留 SQL 工作项，后台扫描补齐。Worker 使用 30 秒租约、350 秒持久化期限、最多 2 次尝试；续租与发布核对 token、revision、会话来源版本及 owner。

取消、归档、删除、版本更新、过期或租约交接后，旧模型响应不能重新覆盖结果或生成执行。取消后占位结果变为 AUTHORING_STOPPED、保留需求、释放原会话；Mobile 可补条件继续。取消不保证已在途模型请求立即终止或零计费，已交给原 Report 的生成状态仍由 Report 负责。

Mobile 发送 authoringMode=DURABLE，受理后返回持久化状态。旧客户端默认 LEGACY_WAIT；即使 Worker 已取得租约或重复请求命中占位消息，也等待同一 owned job 的终态，不另开模型计算。所有等待使用原期限，不无限重试。

FactQuery 延续注册、Memory 候选、需求摘要、建议结果和 AuthoringJob 完成共用最终事务，防止“消息保存但恢复入口未注册”。方法/Memory 引用沿原当前版本核对。

### 用户投影与 API

| 入口 | 行为 |
| --- | --- |
| POST /api/conversations/:id/messages | 原请求入口；新增可选 authoringMode，旧客户端兼容。 |
| GET /api/authoring-jobs/:id | owner-only 生成进度，不返回输入、凭据、lease 或 token。 |
| POST /api/authoring-jobs/:id/cancel | owner-only 取消本次需求计算；终态重放保持已有结果。 |
| GET /api/consumer/goal-experience?limit=10 | 原 Conversation 的只读目标投影，limit 1–20，明确截断与部分不可用。 |
| GET /api/consumer/goal-experience/:id | 读取同一 owned 目标与成果；不创建新的 Goal 权威。 |

投影只使用最新用户 requestId 对应的助手结果；旧报告保留为历史，不充当新需求的完成证据。报告 QUEUED/PLANNING/RESEARCHING/WRITING/REVIEWING/FAILED/SUPERSEDED 都不会显示完成。报告生成完成需要正文，marketFactsVerified 固定 false；创建 Plan 或个人事项不等于现实目标完成，也不再次要求同一审阅。

日程、会话、报告与 WorkItem 共用 conversationGenerationOutcome。报告详情返回其实际 PLAN/TEMPORARY 会话，后台处理中可从日程目标卡进入原报告。没有里程碑分母时不显示百分比。

## 自动验证与证据

下表 API 验证使用隔离用户、*_test MySQL、隔离 Redis 前缀及 fixture/mock 模型；真实 SQL/Redis 不等于真实模型或本人验收。新增显式启用的真实模型验收单独记录，不累计重叠测试。

| 验证 | 结果 | 本地证据 |
| --- | --- | --- |
| V91 联合专项及理解/投影/模型请求合同 | 10 文件 67/67 | [日志](../../artifacts/v91-focused-final-r1.log) |
| 持久化事务与原确认、方法、ResourceGap、事项、一次性审批、网页报告回归 | 8 文件 61/61 | [日志](../../artifacts/v91-regressions-r1.log) |
| 持久化事务最终补验，含超过 100 条历史仍显示当前任务 | 11/11；与上行旧专项重叠 | [日志](../../artifacts/v91-authoring-jobs-final-r1.log) |
| 原报告与 V91 入口/提升联合 | 3 文件 19/19 | [日志](../../artifacts/v91-goal-authoring-integration-r3.log) |
| Mobile 全套 | 68 文件 422/422 | [日志](../../artifacts/v91-mobile-full-r1.log) |
| Plan-schema 全套 | 51 文件 287/287 | [日志](../../artifacts/v91-plan-schema-full-r1.log) |
| 八包 typecheck、共享依赖与 API build | 通过 | [逐项退出码](../../artifacts/v91-final-types-build.json) |
| Mobile Web export | 通过，仅本地产物 | [日志](../../artifacts/v91-mobile-web-final-r1.log) |
| Android Hermes export | 初期导出通过；后续实际安装见T01 | [日志](../../artifacts/v91-mobile-android-r1.log) |
| CI YAML、测试路径与 12 个既有文件保护 | 通过；远程 CI 未运行 | [摘要](../../artifacts/v91-ci-and-preservation.json) |
| hygiene / terminology / data-truth / migration segmentation | 通过 | artifacts/v91-*-r1.log |

联合验证覆盖：保存后未入队、实际 BullMQ Worker 消费、重复受理、owner 隔离、并发租约、旧 holder 迟到、取消中模型返回、过期与尝试上限、删除/版本替代、旧客户端竞争等待、旧合同兼容、临时提升与精确 Brief 冻结、预算更正传入实际模型请求体及报告状态一致性。额外历史上限补验通过，新增测试后的 API typecheck 再次通过，日志 v91-api-typecheck-final-r5.log。

初轮失败保留：共享 dist 缺导出后重新构建；根集成最初三项使用了旧占位状态、错误列名及错误 timeline 身份，修正合同断言后通过；第二轮一项把投影字段 marketFactsVerified 当成原 Report 字段，改读实际投影后通过。未将这些失败运行写成成功。Web 首次 CLI 路径错误日志也保留。

CI Fast Gate 新增 V91 API 与共享合同专项；Full RC 和 Android 条件覆盖 codex/ 系列分支，旧迁移安全门继续执行。未声称 GitHub Green。

### 显式启用的真实模型后端验收

新增 scripts/verify-v91-real-report.mjs 与 apps/api/test/v91-real-report.integration.spec.ts。测试默认跳过；仅脚本显式启用真实模型，每轮创建新的指定前缀 *_test 数据库、迁移该新库，使用 Redis 6391/15 和唯一队列前缀。沿原 API 注册虚构用户，提交 DURABLE 需求，实际 BullMQ Worker 调度原 ReportModel 的 HTTP 请求；只适配已有私有开发配置的解析，不替换模型方法或网络响应，不保存或打印密钥。

验收场景是“荆门租赁2工位人工洗车＋基础美容，10万元预算”，在报告 Worker 启动前改为“15万元总投入上限”。新请求继承原项目并覆盖预算；旧报告在模型调用前 SUPERSEDED。App 自主生成提示词、提纲、完整正文、三情景计算和质量检查，随后验证同请求重放与终态任务重投不会再次调用模型。

首轮自动断言通过后，复读实际稿发现月度利润与单台成本混用，以及依据不足的收入弹性强弱判断，不能据此把模型质量检查视为完全正确。现增加同一财务假设的程序月度校验与收入弹性，分别用于写作、复核，并收入同一 M1 内容和可见附录；生成仍复用原财务公式。等比例收入变化不冒充利润敏感性或真实客流响应，零收入不计算弹性；有效营业天数变化的金额降幅与比例降幅分开。报告更新会替换旧附录，不叠加旧参数。

最新 fixture 回归 6文件40/40，真实模式1项默认跳过：[日志](../../artifacts/v91-report-financial-final-r2.log)。包含月度总成本、独立有限差分验证收入弹性、零收入、M1与附录一致、旧表替换、模型请求传递，以及原网页报告与V91持久化入口。

最终真实模式 r3：1/1，通过3次真实 deepseek-flash HTTP调用自主完成1093字符提示词、5章、7528字符正文及程序附录；初始资金合计150000元，包含营运资金，遵循本次15万元上限；模型检查阻断项为空、4项非阻断建议原样保留。程序M1数据、来源hash、模型实际请求快照、正文、用户投影、owner隔离、旧报告停止及重复请求无额外调用均通过。此结果仅关闭真实模型隔离后端子项。

| 新增验证 | 结果 | 本地证据 |
| --- | --- | --- |
| 最终真实模型后端链 | 1/1，3次真实请求 | [日志](../../artifacts/v91-real-report-r3.log) / [脱敏记录](../../artifacts/v91-real-report-r3.json) |
| App自主生成原始产物 | 提示词与完整报告均由模型链生成 | [结构化报告](../../artifacts/v91-real-report-r3.json.report.json) / [Markdown](../../artifacts/v91-real-report-r3.json.report.md) |
| 修正后API类型检查与构建 | 通过 | [类型日志](../../artifacts/v91-api-typecheck-real-report-r3.log) / [构建日志](../../artifacts/v91-api-build-real-report-final-r4.log) |
| CI YAML与测试路径 | 通过，34条路径存在；真实模型不进入自动付费门 | [检查](../../artifacts/v91-real-report-ci-r1.json) |

首轮r1与中间r2的模型记录、提示词及报告全部保留，不以最终稿覆盖。最初构建命令使用错误的Nest CLI路径，失败日志保留；修正至实际已安装的CLI后最终构建通过。历史Mobile 422/422、Plan-schema 287/287及导出结果保留，本轮没有修改其代码，也未把已有结果冒充新的全套运行。

可复现命令（在仓库根目录，需已安装依赖、构建数据库包、已有私有开发模型配置及隔离 MySQL/Redis；两条输出路径均须全新）：

```powershell
node scripts/verify-v91-real-report.mjs --log artifacts/v91-real-report-NEW.log --evidence artifacts/v91-real-report-NEW.json
```

边界：此场景没有网页连接，只有明确假设的程序计算 M1；报告完成时投影 marketFactsVerified 仍为 false。不生成 Plan、Execution、Invocation、DeviceTask、Truth 或资源授权。模型检查与建议不是现实核验，也不保证所有叙述推论正确；预算遵循是本次场景实测，不等于通用跨领域约束求解已完成。

### 独立进程硬中断与恢复验收

新增 scripts/verify-v91-authoring-recovery.mjs、v91-authoring-process.integration.spec.ts 和独立 Worker 夹具。每轮创建新的 lazy_armor_v91_process_*_test 数据库、独立 Redis 队列前缀；子进程加载构建后的原 AppModule、AuthoringJobs 和 Report 服务。模型响应使用夹具并阻断网络，SQL、Redis、BullMQ、进程终止与重启均实际发生；没有修改时钟或持久化租约。

最终 r2 三项 3/3：计算中强制结束 Worker 后原请求恢复到同一结果消息；强制结束后通过原 API 取消，重启保持取消且同会话新请求完成；报告 WRITING 中强制结束后复用已保存的提示词、需求上下文和相同 M1 hash，完成原报告，不重新规划。中断计算允许第二次尝试；仅已完成结果重放和队列再次投递证明无额外模型调用。六个子进程全部退出，所有场景零 Plan/Execution/Invocation/DeviceTask/Truth、零网络尝试。

证据：[日志](../../artifacts/v91-authoring-process-final-r2.log) / [进程与数据记录](../../artifacts/v91-authoring-process-final-r2.json)。前轮 r1 两项 2/2 保留。API 类型检查、脚本语法及 CI 路径检查通过；CI 加入计算恢复和取消两项，报告恢复仅允许全新专用库，防止扫描共享测试库的历史报告。没有为通过验收修改生产 Engine。

```powershell
node scripts/verify-v91-authoring-recovery.mjs --log artifacts/v91-authoring-process-NEW.log --evidence artifacts/v91-authoring-process-NEW.json
```

需先构建 API，并已启动隔离 MySQL/Redis；两个输出必须为全新路径。此验收证明夹具模型下的真实进程恢复，真实模型结果仍使用前节独立证据，不能互相替代。

## 尚未关闭的门与下一任务

- 历史 0083_runtime_authority_sources.sql 仍需要正式 release evidence，migration:safety 本轮继续拒绝缺证据发布；0091 分段与隔离迁移通过不替代此门。[失败日志](../../artifacts/v91-migration-safety-r1.log)。
- 本次 GoalBrief 字段提取与必要澄清是首场景的有限规则适配，不能据此声称所有生活领域理解与冲突处理完备。
- 独立进程硬中断恢复已完成上述三个隔离场景；实际性能、公平队列、全任务费用配额、跨设备状态和后台 OS 送达尚无新实测承诺，部分属于后续深化任务。
- 隔离真实模型与荆门授权原文真机链、预算更正、重启找回、取消/继续及本人审阅均完成，详见[真机记录](V91_DEVICE_JOURNEY.md)。首轮真实失败保留；不将该单场景等同通用跨领域能力，也不重复索取现有登录、网页许可或GitHub审阅。
- 原 V87 外部 Act/read-back、V88 七个实际连续日期、V89 第三方、V90 联合与发布门保持各自待验状态。

下一任务：按总路线继续V92决策与反馈的合同设计，复用原Memory与验证结果；V91跨领域、全任务费用配额和性能深化独立登记，不被首场景验收覆盖。本地服务与手机更新已发生，未提交、推送或生产发布。
