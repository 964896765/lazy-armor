# V93 报告固定来源与授权版本

2026-10-12：在原报告适配上增加公开读取绑定，不改 Runtime，不增加执行器、数据库表或迁移。V93 仍 IN_PROGRESS，组合方法的逐节点输出与通用 Runtime Recipe 仍未编译。

后续检查点见[报告方法链](V93_REPORT_METHOD_CHAIN.md)：新受理报告已支持逐方法字段输出与传递，本文保留此前固定来源阶段的验收范围；通用 Runtime 编译仍待完成。

## 本次行为

组合报告从 READY 候选中确定每项方法能力的实际连接。只有唯一可用来源时保留默认选择；有多个来源时必须选定。新 `GET /api/conversations/:id/composition-resources` 返回当前账号、会话版本、方法能力及可用连接名称。原 `composition-options` 严格响应没有增加字段。

组合选择的可选 `resourceSelections` 只含方法 ID、公开读取能力和连接 ID。客户端不能传权限、authorityHash、工具实现或 Runtime Recipe。服务端重算原预览，拒绝缺项、越权/未授权来源、未知方法能力和重复绑定。每份报告最多三个不同连接。权限仍须通过原 App 本人开启，选择来源不会授予权限。

服务端在原组合快照保存 `reportReadBindings`，记录连接、能力、原 ConsumerReadSource authorityHash 和观察时间。原 AuthoringJob 的 inputHash 同时绑定这份不可变读取快照；旧任务没有该字段时保留原 hash 算法。相同 requestId 重试返回原任务，换源必须发起新选择，不能用重试标识重复生成。

受理/提交事务复核原连接、grant、health、permission、credential 及撤销审计；公开读取在原 ConnectionsService 收到固定的 expectedSource，并在 Connector 调用前后及用量登记后检查同一权威。共享连接采用确定的加锁顺序。授权撤销后重新开启、配置版本改变、健康证据或权限到期都需要重新核对，不将后来的授权当原任务许可。

原 ReportGeneration Worker 只把固定连接提供给模型，提纲必须包含全部需要的连接。模型新增其他连接、漏掉连接、没有取得所需原文均阻止交付。保存的提纲/资料在恢复时也检查连接与权威边界；不会临时改用新出现的连接。最终发布事务再次核对原组合及全部固定授权。

没有固定来源的旧组合报告若声明了读取需求，明确停止并要求重新核对；无读取需求的报告不从账号其它连接取资料。普通报告保留原自动选源规则。原报告尚未生成结束时不能受理依赖其可变 payload 的新组合，避免任务一入队就因源报告自身进度变化失效。

## 恢复与预算

补齐第二次模型质量检查的预算和方法上下文。修订不能绕过总调用额度。授权在 Authoring 队列计算前失效时保存明确的上下文失败结果，不反复排队重试。测试中的 Authoring SUCCEEDED 只表示生成处理已提交，PLANNER_OUTPUT_INVALID 仍是不完整结果。

报告恢复测试使用隔离 fixture 模拟写作边界中断：已保存提纲和原文复用；新增可用连接不会替换固定来源。此项不是新组合任务的实际子进程强杀验收，真实进程/手机多方法恢复仍待。

## 手机体验

原「能力组合」页显示具体来源名称，歧义时选择连接，可进入原范围页核对。状态失败、版本不匹配、来源未选齐时不能准备报告。来源变化后需重新选择，不自动换成唯一剩余候选。报告与会话卡片说明未完成原因，并提供固定来源范围入口；原登录、逐项授权、计划确认、记忆保存与审批保留。

新 optional 字段兼容旧持久记录；严格解析新报告的客户端须使用本次共享合同与手机包。没有把旧手机或既有 Web 导出包假定为已兼容新绑定快照。

## 验证状态

第二轮隔离联合 55/55（7 文件）；连接配置与时效补查 20/20（3 文件）；恢复/保存范围最终专项 38/38（4 文件）。轮次重叠，不累计成不同测试总数。覆盖确定选源、模型可见范围、撤销/重授权、跨账号和未授权来源、伪造 authorityHash、漏源/换源/缺原文、受理与发布复核、配置版本变化、恢复复用、篡改保存范围、原报告兼容、修订预算及零 Plan/Execution/Truth。共享合同 6/6、Mobile 来源选择 5/5通过。

自动验证只使用 SQL3311 的 *_test 库和 Redis6391 隔离前缀；不把 fixture 当个人报告、真实来源访问或真实方法执行证据。个人库不植入测试方法。Android 安装和本地最终服务状态在下方收尾记录。

待继续：逐节点 typed outputs、官方 Service Recipe、手机/文件等字段范围绑定、原 Runtime 编译、人民币计价上限、未知结果与补偿、真实多方法＋实际资源执行/恢复。报告公开读取绑定不替代这些关闭条件。


收尾：最终共享合同21/21（4文件）、Mobile相关10/10（3文件），API构建r4/类型r4、Mobile类型r3及Android/Hermes r2通过。r2新包保留数据安装后，实际APK SHA256 `C61DE5FC4953803BBAC0CDE523A5FABB9C98E3B059862D4E4EAF237475EFCA3D`、Hermes SHA256 `171BF74AA13439032BF91ADF97A280FE9834BA58E75A62D35FD933DF65549821` 与构建一致。手机已显示原受保护页和五个导航入口，没有登录提示；这不计来源选择或真实多方法生成验收。

个人SQL3307只读检查零活动Authoring/Report/Execution及93条迁移后，更新API PID17140、Execution/Authoring PID21668；原Outbox PID22732保留。三角色均ready；没有SQL迁移，原12个独立登录/执行文件哈希保留，tracked bundle恢复。未提交、推送或生产发布。

私有证据：`artifacts/v93-binding-integration-r2.log`、`artifacts/v93-binding-integration-r3.log`、`artifacts/v93-binding-integration-r4.log`、`artifacts/v93-binding-schema-final-r1.log`、`artifacts/v93-binding-mobile-final-r1.log`、`artifacts/v93-binding-api-build-r4.log`、`artifacts/v93-binding-api-type-r4.log`、`artifacts/v93-binding-mobile-type-r3.log`、`artifacts/v93-binding-install-r2.json`、`artifacts/v93-binding-final-services-r1.json`、`artifacts/v91-device-v93-binding-installed-r2.xml`。
