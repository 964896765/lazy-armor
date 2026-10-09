# P2 最终真实验收 — CLOSED

2026-10-08 22:56 Asia/Shanghai。P1 CLOSED；P2 CLOSED / REAL_VERIFIED。验收手机23049RAD8C，ADB 2c696fe；实际安装APK SHA256：`BB039F73037AEDFA4B6BA067EE399CD1B50CAF0DBD145062AA8045AB6F076CF7`。本记录仅关闭既定P2范围，不代表V8.3全部能力完成。

最终只读证据复核32项通过：[关闭证明](../../artifacts/v83-p24-final-acceptance-reviewed.json)。P2内部事项、显式同步与Calendar可靠性验收线冻结；下一主线P3 ResourceGap Auto Resume，本批未进行P3实现。

## 真实场景与权威边界

| 验收 | 现实结果 | 主要证据 |
| --- | --- | --- |
| 内部事项 | 真实AI/确认、自然到点站内提醒、编辑/延后/完成/取消；默认零外部写 | [P2第一阶段](P2_USER_EVENT.md) |
| CREATE与中断恢复 | event19真实create commit-gap，unknown保留，lookup-only→Verification/Truth→Link；不创建Plan | [P2.3证据](../../artifacts/v83-p23-real-sync-acceptance-reviewed.json) |
| UPDATE | 实际UI编辑v2、独立确认/审批；event20仍为同一外部身份，23:28改到23:48，read-back VERIFIED，Link绑定v2 | [UPDATE复核](../../artifacts/v83-p24-update-real-reviewed.json) |
| DELETE | 内部取消v3、独立确认/审批；真实event20缺失；签名证据absent=true且observedBeforeMutation=true；独立presence Truth，Link DELETED/ABSENT | [DELETE复核](../../artifacts/v83-p24-delete-real-reviewed.json) |
| UPDATE permission denied | 实际撤销Android WRITE_CALENDAR；内部ACTIVE v2不回滚，外部event21仍23:39，无update Invocation、无v2假VERIFIED；系统UI恢复权限后续同一冻结请求/独立审批 | [权限拒绝](../../artifacts/v83-p24-update-permission-denied-real.json) |
| UPDATE unknown recovery | CalendarProvider已将event21更新至23:49，PREPARED持久化但无Native Result；自然lease expiry→unknown；实际App force-stop/恢复→原lookup Task→VERIFIED Truth、RESOLVED、Link v2 | [提交边界](../../artifacts/v83-p24-update21-commitgap-before-kill-real.json)、[回查恢复](../../artifacts/v83-p24-update21-after-app-resume-real.json) |
| DELETE offline | 手机API连接切断并跨过心跳freshness；已有owner协议独立批准显式删除，原Execution waiting_dispatch、Task PENDING；内部CANCELLED v3，event19仍存在。恢复连接后同一身份删除并缺失验证 | [离线权威](../../artifacts/v83-p24-event19-delete-offline-settled-real.json)、[恢复结果](../../artifacts/v83-p24-event19-closure-real.json) |
| 确认/启动重放 | 四个mutation的confirm/start各3次，共24次；原事项版本、Request、Execution保留，不重新授权/执行 | [真实协议重放](../../artifacts/v83-p24-mutation-confirm-start-replay-real.json) |
| 实际终态回执重复交付 | 用真实已提交lookup/update与delete回执、现有手机硬件签名器和既有complete路径；各3个新签名请求201，返回原Task；同一签名envelope重放409；历史Verification/Ledger不新增或改写 | [最终部署交付](../../artifacts/v83-p24-native-delivery-replay-real-r6.json) |
| 重复真实来源 | 实际资源UI读取event21并正常交付；原签名重放409，同一实际读取内容的3次新签名交付保留各自acquisition/Observation，USER_EVENT与USER_EVENT_SYNC Execution集合不变，无额外mutation | [来源重放](../../artifacts/v83-p24-source-envelope-replay-real.json)、[来源前后权威](../../artifacts/v83-p24-source-after-duplicate-real.json) |
| COMPLETE | 实际UI完成event21内部事项为v3；外部event21保留、Link仍证明v2；重复旧回执后仍VERIFIED，不提出update/delete | [最终完成权威](../../artifacts/v83-p24-event21-closure-real.json) |
| Worker/Outbox/App重启 | 真实进程重启、原身份/冻结合同/已解决case/历史证明保留；新部署API与两Worker ready=200 | [最终部署](../../artifacts/v83-p24-runtime-deployment-r4.json)、[ready](../../artifacts/v83-p24-runtime-deployment-r4-ready.json) |

原event19 unknown Ledger `01a118af-7b88-7330-8f1f-4860a7754249`和原Verification保留。UPDATE unknown Ledger `01a11bcc-048d-72db-bfce-ff028ae89f67`始终OUTCOME_UNKNOWN；后续证明由Verification `01a11bea-715e-722b-8078-34603b181626`及resolved case `01a11bcc-0467-7676-9d03-f97fa01d6b25`承担。不得把历史unknown改为成功。

最终CalendarProvider查询：event19、event20不存在；P24标题范围只剩真实event21，仍23:49–00:19，无替代event或重复写。完成内部事项不删除外部历史；取消仅提出受控DELETE，执行仍需独立确认和审批。

## 本轮实际修复与验证

1. 首次create确认的自动恢复查询混用UTC存储与数据库本地NOW()。改为绑定服务端Date，不改变Runtime结构；已有multi-authority集成7/7通过，后端部署。该修复是代码/回归证明；首轮真实seed启动使用合法公开start，不冒充自动启动已真验。
2. 相同签名请求的数据库唯一约束已挡重放，但Drizzle包装driver错误使API返回500。修复cause链识别，明确409；针对性9/9通过，真实原来源和终态回执重放409复验通过。
3. 内部完成后旧终态回执重放将历史Link误标CHANGE_PENDING。修复completed保持VERIFIED且保留实际同步版本；既有7项multi-authority集成补充同一回执重放断言后7/7通过，最终部署真回执复验通过。

先前API主28、mutation/registry7、Shared28、Mobile Runner19回归及构建证据保留；本次针对性回归与后端构建不替代真实手机证据。

## 验收的明确限制

提醒交付仅**persisted in-app notification**。Android OS push/后台系统级送达尚未验收，也不包含在本次P2关闭范围。

离线DELETE的独立审批通过既有合法owner API harness完成；完整真实UI确认/审批已在event20 DELETE验证。UPDATE commit-gap的调试器暂停先于自然lease expiry，实际force-stop随后发生，不能声称单纯kill导致过期。

event19 DELETE的post-commit调试断点未命中，仅作为失败尝试；本记录不宣称DELETE专属commit-gap已真验。UPDATE真实unknown恢复和已有CREATE恢复满足本批冻结的故障隔离范围；DELETE unknown合同证明仍单独记自动化级别，不增加新fault case。

新签名交付相同读取内容产生不同读取证明/Observation；它们不是同一个Observation ID重放，不合并或删除来源/Truth历史。精确相同envelope在签名权威门拒绝，重复来源不自行创建内部事项或外部Invocation。签名由原手机现有硬件私钥完成，未导出密钥，未伪造receipt、注入生产数据库或增加生产后门。

调试App设置与JDWP forward已清理，手机连接和系统Calendar权限恢复。P1历史Plan/Event18证据保留，P4布局/Skill/Provider/MCP范围冻结。
