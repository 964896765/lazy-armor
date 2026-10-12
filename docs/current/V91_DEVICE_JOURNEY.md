# V91 真机目标与报告验收

任务：V91-T01（荆门报告首场景）。状态：REAL_VERIFIED，用户已审阅生成与查看流程。2026-10-11开始，2026-10-12完成本场景验收；不表示完整Personal Life OS或生产发布完成。

用户重新连接 Redmi 23049RAD8C，并亲自解锁。正常 App 已显示“我的目标”“创建目标”“目标下一步”，登录及原数据保持。验收沿日程“创建目标”进入会话，用原手机输入框提交荆门城区、租赁2工位人工洗车加基础美容报告，10万元预算明确为测算假设。输入与发送由开发验收操作，不能声称本人已审阅报告。

## 本地准备

新库表此前仅在隔离环境验证。真机连接后先核对现有开发库只有0091待执行、历史SQL无内容漂移、无活跃Execution/Outbox/DeviceTask租约或报告，再保存25,366,146字节开发库备份，仅应用0091的可空GoalBrief列及两个新增表。原91条migration ledger逐条不变，两表和新列核对齐全。备份留在被忽略的本机.data/local-backups，不上传，不声称已通过restore gate。

证据：[增量与备份摘要](../../artifacts/v91-device-local-additive-r1.json)、[迁移后只读核对](../../artifacts/v91-device-schema-after-r1.json)、[服务恢复](../../artifacts/v91-device-services-r1.json)。最初本地预检错误地把外键ON DELETE RESTRICT判为数据删除，停止于操作前；修正为实际删除语句匹配后再执行，没有更改0091。

Android新包经过实际JS配置guard、Hermes、Gradle构建和adb install -r。安装APK与构建SHA256同为52283cc547024abd99cb1b2988336bd887663dd842d3d070496c317995909baa，原登录/Runner十二文件与tracked bundle字节保持。安装前旧APK已留本机。安装后手机进入AOD/锁屏，用户随后亲自解锁，才收取正常页面证据；黑屏截图不视为App成功。

## 首轮真实失败与修复

原App实际接受DURABLE请求并创建持久化AuthoringJob，需求整理一次成功交给原Report；离开会话后的日程显示同一目标。模型自行生成1167字符提示词、研究问题和财务参数，随后报告FAILED / REPORT_WEB_SOURCE_REQUIRED，正文为空。首轮记录保持：[只读数据](../../artifacts/v91-device-failed-flow-r1.json)、[App需求与结果](../../artifacts/v91-device-summary-r1.png)。该结果不计报告完成。

两项问题：需求摘要的有限规则没有识别“10万元预算只作本次测算假设”和无“在”前缀的“湖北荆门城区”；网页权限仍开启，健康检查却已过期，Report未使用原ConnectionsService.preparePublicWebRead刷新检查，捕获来源权威时拒绝。

需求解析补入数额在前的预算、总投入上限及荆门项目表达，保留原话来源；紧随预算的假设声明仍为ASSUMPTION。Report在首次捕获网页来源权威前复用原preparePublicWebRead，先核对原grant再实际检查连接，不重新授予权限；读取及发布仍按原来源hash防止撤销/重授权被掩盖。未知地点仍不做地理推断。原FAILED不重写，下一轮经App新消息继续。

需求/报告上下文/冻结合同20/20已通过：[日志](../../artifacts/v91-device-requirements-tests-r2.log)。首次扩展正则把逗号作为数字首字符，触发两项原回归失败；改为必须数字开头后通过，不削弱原断言。最终隔离4文件31/31（与20项部分重叠）通过：[日志](../../artifacts/v91-device-web-recovery-tests-r1.log)。覆盖过期检查自动续检、原grant字节不变，以及无权限时连健康探测也不启动。API typecheck及build通过；Mobile源码本次未再改动，不重跑或重计历史全套。

## 修复后的真实闭环

沿原手机会话重新发送同一10万元假设需求，生成1202字符提示词、8717字符正文；后台实际读取3篇荆门官网原文，URL、发布日期、读取时间、正文与hash均保存。必应搜索当前不可用，实际候选来自网站入口，标为AUTHORIZED_SITE_DISCOVERY；一篇正文超过上限，只保留前10000字符，限制明确披露。相关页面主要为营商与人才政策背景，不证明当地洗车租金、车量或客流。

随后在同一会话通过输入框将假设总投入上限改为15万元并包含营运资金。App自主生成1167字符提示词、7章、9897字符完整正文，原需求地域与2工位范围保留；财务初始合计150000元，其中营运资金52000元。模型检查无阻断项，4项建议原样保留。M1程序计算及附录可重新核对，基准现金利润88.80元/月、含折旧利润-1111.20元/月，报告相应说明边际可行和产能待核实。模型建议与产品审阅不视为现实事实核实。

开发验收经App点击“停止本次需求处理”，取消另一项仅准备方案的计算；数据库CANCELLED/STOPPED，原消息AUTHORING_STOPPED。随后同会话发送“我想创业”，新任务SUCCEEDED并返回CLARIFICATION_REQUIRED；原取消状态保持，没有创建执行。五个一级入口正常查看，App强制结束再打开后登录仍在，从日程点击“已完成”再点击第一项成果，两次点击找回同一15万元报告；提示词展开与收起正常。

用户在当前对话明确回复“已查看，流程符合预期”。该回复只记录生成与查看体验，不授予新增资源或执行权限，也不声称市场事实已核实。本轮数据库总数与操作前快照一致：Plan18、Execution30、Invocation65、DeviceTask66、Truth385，增量均为零。首轮FAILED与旧10万元报告保留。

| 最终证据 | 范围 |
| --- | --- |
| [只读最终数据](../../artifacts/v91-device-final-flow-r4.json) | 原请求、预算修改、取消与同会话继续 |
| [15万元原始报告](../../artifacts/v91-device-budget-completed-r3.01a12ddaf2a5729abe093889b0e72119.report.json) / [正文](../../artifacts/v91-device-budget-completed-r3.01a12ddaf2a5729abe093889b0e72119.report.md) | App实际生成，非人工代写 |
| [提示词显示](../../artifacts/v91-device-prompt-visible-r3.png) | 实际App展开自动提示词 |
| [重启后找回](../../artifacts/v91-device-restart-report-r3.png) | 同一修订报告和原登录 |
| [取消界面](../../artifacts/v91-device-cancelled-r2.png) | 正常App取消并保留需求 |
| [本地服务](../../artifacts/v91-device-services-r2.json) | 修复后原三角色及源码hash |

本场景关闭：表达/需求摘要、后台模型与授权原文、预算更正、离开/重启找回、取消/重新提出需求、本人查看。跨领域理解、全任务费用配额、公平队列、性能与后台OS送达仍为后续深化；本场景的成功不能替代它们。

范围：这是本地开发部署与正常入口验收，没有生产发布、提交或推送。系统页面读取权限本次不参与网页报告，不重新索取。历史0083发布证据门、V87外部Act、V88七天、V89第三方及V90联合验收各自保留。
