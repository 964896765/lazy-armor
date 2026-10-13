# S0 首批整改验收 · 2026-10-13

基线：8307b1d。关联[执行方案V1.1](PROJECT_OPTIMIZATION_PLAN_V1_1.md)的FIX-03、FIX-17、FIX-01。

独立源码提交：FIX-03 `78309fb`，FIX-17 `87b9574`，FIX-01 `a15b3ac`。验证针对本轮最终源码，以上提交未修改既有SQL迁移或个人配置。

| 任务 | 修改 | 冻结范围与结果 |
| --- | --- | --- |
| FIX-03 | 导出CompositionRuntimeCompilation，PlannerResult使用确切可选类型，消除原4项错误 | 构建合同范围CLOSED；全仓typecheck/build各8/8。未接通编译器的真实执行仍待原任务验收 |
| FIX-17 | 明确核对10个Connector名称，继续逐项验证能力、权限、SDK和副作用 | CLOSED；原失败回归与测试Connector环境隔离联合7/7 |
| FIX-01 | 演练目标白名单、原库保护、同服务器、环境/远端范围、取消账号回退、Docker端口核对、CLI固定TCP | 目标隔离范围CLOSED；31项安全测试、危险CLI拒绝及真实隔离dump/restore通过 |

组合合同仍是草稿证明，executionAuthorized=false保留。增加类型与导出不增加调用、资源授权或执行入口。原schema、客户端数据、方法上限与Runtime权威保持。

Connector明确核对content_provider/file_provider/gmail/google_calendar/internal/logistics_provider/manual/public_http_json/public_web_research/webhook，公开网页适配器纳入原fail-closed harness，开发测试Connector的staging/production拒绝回归保留。

**备份安全规则**

- 临时库仅允许lazy_armor_backup_test、lazy_armor_restore_test或附8–32位十六进制唯一后缀；latest、任意包含test的名称、系统库和SQL片段拒绝。
- 应用库、管理连接默认库、备份库、恢复库按大小写不敏感比较互异；URL编码先解码，不能绕过原库保护。
- URL必须包含明确账号、单一合法库名和合法端口，拒绝query/hash/socket；应用/管理host与port一致。
- 本机development/test兼容原参数。独立staging演练要求APP_ENV=staging、非production测试进程、确切BACKUP_RESTORE_ALLOWED_TARGET=host:port；production模式拒绝，应用配置不改写。
- 管理账号失败停止，不自动改用应用账号重试DDL；授予临时库权限时转义账号值。
- 原生CLI固定TCP；Docker回退先核对容器3306发布地址/端口，使用原管理凭据，不改用另一实例。
- 导入模块不自动运行，直接CLI入口保留。危险输入断言数据库连接、文件写入、子进程调用均为0。

**本轮验证**

| 检查 | 本机证据与结果 |
| --- | --- |
| 全仓类型 | 8/8；artifacts/optimization-s0-typecheck-r1.log；后续端口补充由最终build编译核对 |
| 全仓构建 | 8/8实际构建，无缓存；API/Admin/Expo Web成功，artifacts/optimization-s0-build-r1.log |
| Database安全 | 最终31/31，artifacts/optimization-s0-backup-tests-r2.log |
| Connector/harness | 2文件7/7，artifacts/optimization-s0-connector-tests-r1.log |
| 共享合同 | 56文件312/312，artifacts/optimization-s0-schema-tests-r1.log |
| 危险CLI | latest在连接前以BACKUP_RESTORE_DATABASE_NOT_ISOLATED拒绝、exit1，artifacts/optimization-s0-backup-cli-rejection-r1.log |
| 实际隔离演练 | Test MySQL3311中新母库与两个临时库，93迁移、既有fixture、dump/restore/比较通过；母库标记hash和唯一表数保持，artifacts/optimization-s0-backup-isolated-r1.json及日志 |

最终相关回归350项（31+7+312），重叠轮次不累计。构建不代替浏览器/真机旅程。Fast Gate接入Database安全单测，置于依赖审计和迁移之前，原发布门保留；没有声明远端Green。

本轮只在新隔离命名空间运行，没有访问个人3307数据库、运行生产迁移或安装手机包。新SQL库/dump保留为私有证据，不上传。

**剩余项与回滚**

FIX-13的V91–V93非空GoalBrief/Authoring/学习/方法结果/预算恢复仍PLANNED，本轮既有fixture成功不能关闭它。0083正式发布证据、依赖、Admin、身份、队列与交互问题继续按原账本推进，S0整体不提前关闭。

零新SQL迁移、执行/授权入口和生产部署。回滚可单独撤回对应源码提交，不涉及个人数据或原迁移文件。当时下一切片FIX-02已在[第二批Admin验收](OPTIMIZATION_S0_BATCH_02_ADMIN_AUTH.md)按范围完成。
