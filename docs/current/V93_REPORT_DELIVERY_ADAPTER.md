# V93 组合报告交付与任务预算

2026-10-12：报告适配与持久预算实现，自动验证及保留数据安装完成。V93 保持 IN_PROGRESS，通用组合 Runtime 未编译。后续[固定读取绑定](V93_REPORT_RESOURCE_BINDINGS.md)已实现具体公开来源与授权版本选择/复核，第二次模型检查也已纳入原预算。

报告目标经原组合入口核对后，进入原 ReportGeneration 队列，自主整理提示词、选择授权来源、生成正文、程序计算与检查。`REPORT_GUIDANCE_V1` 保存精确方法版本、内容、拓扑顺序、字段关系和成果标签，提供给原报告模型的规划、写作及检查。每个选定成果标签必须进入提纲章节，正文沿原完整性检查保留所有章节；遗漏成果阻止交付。该适配交付一份报告；方法间 typed outputs 没有逐节点执行，不能作为独立方法执行证明。

范围限定为文本成果、READ 声明及原报告 Worker 支持的公开 HTTP / 网页读取能力。其他资源或写入/通知不能通过此适配。含历史 Memory / Truth 来源的 GoalBrief 暂拒绝，直到逐版撤回适配完成；不能仅凭历史 hash 视为长期有效许可。接口受理前检查范围，Worker 重查当前资源和原来源；报告发布事务再次复核 owner、会话版本、原消息与方法版本。网页读取继续沿原逐项授权与读取范围，发布前核对 authorityHash。

所有新报告从入队起保存 20 分钟截止时间、最多 16 次实际模型请求、131072 个预留输出 token。每次网络请求（包括 JSON 纠正、失败请求和恢复后重试）先在原报告 revision 栅栏下保存一次 8192 token 预留；不退款，不重置。模型超时取原单次 90 秒与任务剩余时间的较小值。资源读取前及最终发布前检查截止时间；不会在超时后启动下一项读取或发布完成结果。已开始的资源读取使用原 Connector 超时，未新增强制中断合同。

预留输出 token 是请求上限，provider 的 total_tokens 是已观察输入与输出用量，二者分别记录。没有可靠模型价格配置，费用标为 NOT_PRICED，不虚构人民币成本，也不宣称已经实施人民币费用上限。旧任务缺预算时第一次恢复保存新预算，历史未记录请求不能追溯计数。

手机报告页新增本次方法、成果标签、模型请求数、截止时间及实际收到的用量。原提示词、来源、正文、检查、个人决策确认保留，无新增权限或自动记忆确认。

无需新表或 SQL 迁移；沿原消息 JSON、队列、取消、版本失效与恢复。个人库不植入 fixture，自动验证仅使用隔离测试库。

待关闭：严格逐节点输入输出执行、官方 Service Recipe、实际字段范围资源绑定、人民币费用预算、补偿与未知结果、真实多方法执行/恢复闭环。它们不能由报告生成通过替代。

验证：隔离联合 41/41（组合交接、报告适配、遗漏成果、来源撤回、方法关闭、截止/调用超限与原网页授权）；共享合同 19/19；Mobile 9/9；API 最终构建/类型及 Mobile 类型通过。证据分别为 `artifacts/v93-report-delivery-tests-r3.log`、`artifacts/v93-report-schema-r1.log`、`artifacts/v93-report-mobile-regression-r1.log`、`artifacts/v93-report-api-build-r3.log`、`artifacts/v93-report-api-type-r3.log`。没有把隔离 fixture 当个人真实报告执行。

Android/Hermes 构建通过，保留数据安装后实际 pull 的 APK/HBC hash 与构建一致（`artifacts/v93-report-install-r1.json`）。真机登录保留；统一手机应用目录已补验精确搜索与已接入计算器直达原能力页。当前135个应用与ADB启动入口去重并排除本App后的135个一致，未新增连接或权限确认（`artifacts/v93-report-phone-entry-acceptance-r1.json`）。报告的真实多方法旅程仍待，不代本人启用方法或植入个人 fixture。

本地 Docker 的三个失效临时 socket 已备份处理并恢复引擎，未恢复出厂或删除容器/卷。测试专用 SQL3311/Redis6391 与原开发 Redis6379恢复；个人开发SQL3307迁移仍93条，没有运行迁移。最终API PID22624、Execution/Authoring PID6476、Outbox PID22732。原12个独立登录/执行文件哈希保留，tracked bundle恢复。未提交、推送或生产发布。
