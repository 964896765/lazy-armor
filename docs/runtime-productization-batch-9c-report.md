# Batch 9C — Google Calendar 非 Secret 实现与隔离回归

日期：2026-09-13；代码基线 main@fb57464acc320522e928dc6890406faa83d29d07。状态：非 Secret 实现与完整本地门禁通过，同提交远端门禁待验；**真实 Google 账号验收未执行，9C/9F 不关闭**。缺 Secret 只阻塞真实授权验收，不阻止 GitHub/Notion 非 Secret 接入。

## 实现与安全边界

- 复用 GoogleOAuthClient / GoogleOAuthSessions / Connections / Credentials；共享 Client ID/Secret，Calendar 独立 HTTPS callback URI，state + PKCE + CAS/token exchange/refresh/revoke。不复制认证系统。
- 三项实际 REST Adapter：READ_CALENDAR_EVENT、CREATE_CALENDAR_EVENT、UPDATE_CALENDAR_EVENT。Manifest revision 2、Evidence revision 1、Policy revision 1，实际 Token Scope Grant、Health TTL、应用 request/quota budget、Google 标准错误映射和 read-back VerificationPolicy。
- 只读及写入绑定实际本人 primary calendar；最窄 metadata/events Scope、owner isolation、缺配置 production DISABLED。status.realAccountAcceptance 恒为 NOT_VERIFIED，oauthConfigured/connected 不等于验收。
- CalendarEvent / calendar_event.schedule Schema 与 Generic Parser/Normalizer，account/connection/event 语义隔离、有界列表、300 秒 Freshness，汇入现有 Observation → Candidate → Truth Version / Provenance。
- 写动作采用已有 publish 外部动作容器，R3 风险与不可变批准上下文，Existing Runner/Outbox/Verification/Reconciliation。更新固定 eventId/ETag，条件 PATCH If-Match；创建 POST 后按实际 eventId GET，比对标题、时间/时区、全部参与人、状态和操作相关性。
- 一次写入，网络断开不重发；409 只读比对；成功 POST/PATCH 后 GET 失败不能宣称无副作用。同步修正 Gmail 同类安全分类，不重写任何冻结 Engine 或修改其已发布能力 revision。

精确字段、Scope、回调与第一版限制见 [9C design](./runtime-productization-batch-9c-design.md)。未经核实的其他官方能力仍 TO_VERIFY_OFFICIAL；不扩大删除、ACL、会议/附件能力。

## Migration / Schema 交付

DDL migration **N/A**：不需要新列，复用 0046 Google OAuth CAS 状态、现有 credential / provider registry / generic fact / immutable Truth / verification / reconciliation 表。Manifest/Fact/Parser 是 additive Registry revision，不另造 Calendar 认证或领域事实表，也不改已应用 migration。Migration Contract 新增共享存储与无重复 Calendar Engine/Auth 表断言；47 个迁移均安全/重放通过，destructive=0，Drizzle segmentation 通过。

## 专项测试证据

API 五文件 **49 passed**（Start at 17:37:05，21.72s）：Calendar Adapter unit 14、Calendar actual-adapter TCP/DB integration 8、Gmail unit 13、Gmail TCP/DB 9、Migration Contract 5。Config 三文件 **36 passed**（17:37:16，957ms），含 Calendar 独立禁用、共享凭证、部分配置、HTTPS/精确路径。

Calendar DB/TCP 不只是 stub service：以实际 ProviderAdapter 经固定 Google REST transport 注入本地 TCP server，真实 MySQL 事务与既有 API/Runner。4 路 OAuth callback 只有 1 路 token exchange；实际未授予 write Scope 不能人工补造；错误/取消 callback 一次性消费；3 路认证读取仅 1 Observation/Candidate/Truth；429 degraded/RATE_LIMITED 后重新 primary 验证才恢复；refresh 正常新 version；revoke 关闭授权/Health。

跨 Provider 隔离 Journey：实际 Gmail Adapter 读会议信息 → 三个 Generic Truth → 用户审批完整上下文 → Calendar Adapter POST，服务端已写 event 而 TCP 断开 → 并发 Outbox claim/process 仅一项副作用 → 并发 Reconciliation claim 仅一项回查 → GET/eventId/字段比对产生 SUCCEEDED VerificationEvidence；旧 Outbox message 再处理不重发，历史 Operation 保持 outcome_unknown、attempt_count=1。随后批准更新事件，经同一 Existing Execution 使用 If-Match PATCH 并存储 SUCCEEDED evidence。**本地 TCP 的实际适配器并发闭环不是 Google 真实账号 Journey，不替代 9F 实际平台验收**。

首次专项测试发现的路由、HTTP 限流返回契约、动作 config/容器及 SQL 测试字段错误已修正后重跑，未为测试改写 Runtime 或迁移。

## 全量门禁

Full API **80 文件 passed、1 skipped；511 passed、4 skipped / 515**（17:40:00，434.74s）；完整 Monorepo **16/16**（8m2.159s），无 cache 跳过实际回归。Mobile **16 文件/99 项**、SDK **4 文件/50 项**、Schema **9 文件/42 项**、Config **3 文件/36 项**通过。Monorepo build **8/8**（22.817s）、typecheck **8/8**（14.58s）。Migration safety/replay、production data-truth、production dependency audit（无已知漏洞）、repository hygiene **638 tracked files**、cached diff whitespace 通过。同提交 GitHub CI 将按实际完成结果补记，不从 9B 继承结果；本地通过与 skipped 均不替代远端/真实账号验收，不标 Final Runtime FULL GREEN。

本地源码日志：`.data/batch-9c-focused.log`、`.data/batch-9c-config.log`、`.data/batch-9c-build-verified.log`、`.data/batch-9c-typecheck-verified.log`、`.data/batch-9c-monorepo-verified.log`。历史专项失败日志保留，不隐藏成通过。

## 单独待办的真实验收

尚无真实 Google Secret/用户授权，未读取真实日历/邮件、未创建真实邀请。真实主日历读写、OAuth/refresh/revoke/实际 scope/account access、429、网络断开、unknown、eventId read-back 与真实 Gmail→Calendar Journey 全部通过后才能关闭 9C/9F。Secret 只经本地安全配置或 secret manager 注入，禁止聊天/提交 Git。

## 同提交远端门禁进度

main@02e77bd74d51024444450aa56bceba4417066245 的 [release-candidate-ci #66](https://github.com/964896765/lazy-armor/actions/runs/34750300128)：Fast Gate（103705523689）、RC Full（103705709563）、Android（103705709586）**全部 success**。RC Full 的 MySQL 8.4 migration/backup-restore、实际 DB concurrency Monorepo 与完整 build 步骤已逐项核验 success。证据属于本提交，不从 #65 继承；远端代码/构建通过不替代真实 Google 账号或真机验收，不关闭 9C/9F。

MySQL artifact **10315288872**：`mysql84-migration-evidence-02e77bd74d51024444450aa56bceba4417066245`，expired=false，head_sha 与本批提交一致，digest `sha256:0835bbc0889b8fc4a6f0beda666fa8affbaef44d16f1717b2dd6900597cd2589`。GitHub 插件查询遇到网络失败，已用该公开仓库的 GitHub REST 只读查询继续核验，不索取/暴露任何新 Token。

Android artifact **10316706244**：`android-verification-02e77bd74d51024444450aa56bceba4417066245`，expired=false，head_sha 与本批提交一致，digest `sha256:14325730edc68bfe1a1380d0523ceafe3c37892b483bca2788c11c415a9caa93`。这是 DEBUG_VERIFICATION_ONLY 构建产物，不是可发布包或真实 Android Beta 验收。
