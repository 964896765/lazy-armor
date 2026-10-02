# Batch 9D — Signed Webhook / Read-only Acquisition 子步骤

日期：2026-09-14；代码基线 `main@f6752cbe5833b4ba13a708f3555dbe651f94320b`。本报告仅描述 GitHub 9D 的非 Secret 隔离接入实现；不关闭 9D，不声称真实 GitHub 已完成。

## 增量边界

继续复用 Connections、CredentialProvider、Permission/Grant、Provider Runtime Health/RateLimit/Quota、SourceObservation、Candidate、Generic v2 TruthVersion/Provenance/Audit。没有新的领域 Engine，没有重写既有 Plan、Strategy、Risk/Approval、Execution/Outbox 或 Verification/Reconciliation。

- `POST /api/providers/github/connections/:id/webhook` 为 GitHub 服务端公开回调，仅接受 HTTPS、JSON、无 query 和有效 UUID，复用捕获的原始字节及普通 API 256KiB 上限。先做 raw HMAC SHA256 验证，再作业务提示解析；不使用 stringify 验签。共用 Express JSON parser 仍进行基本 JSON 解析，未修改公共 parser。缺 signing Secret/OAuth 配置时 fail-closed。
- 支持 repository `issues`、`pull_request`、`workflow_run` 的允许 action；unsigned Event header 必须与单一 signed body 形状吻合，不作资源权限证明。绑定实际 repository ID/规范名称、资源 URL、Issue/PR number、PR base repo 或 workflow repo；不信任 sender（允许 ghost），不把 fork head 当成 base repo。
- Admission 从连接拥有者与当前凭据解析授权仓库快照，事务复核 active user、connected connection、active/current credential version、legacy READ permission 与 Grant/repo Scope。只保留 schema/repository/capability/resourceType/resourceId/number/runId，删除原始 title/body/state/conclusion/action/sender；原始 payload 永远保存为 `{}`，snapshot 另存 hintHash 做完整性校验。敏感原文不入库。
- 复用 existing webhook_receipts，两条现有 unique identities 分别承载 connection delivery 与 connection raw-body hash。相同 body 改 Delivery header 复用原 receipt，相同 delivery 不同 body 拒绝；即便新 body 已属于另一 receipt，delivery 冲突仍优先拒绝，不能依赖 OR 查询返回顺序。
- 存储及 Audit 成功后返回 202/PENDING、`truthConfirmed=false`，不等待网络 GET，不冒充 Truth/Action/Journey 成功。JWT 保护的 `GET /api/providers/github/webhook-receipts/:id` 仅向当前连接拥有者返回状态/尝试/时间/最小结果。
- `0048_webhook_acquisition.sql` 只为 existing receipt 添加七个 nullable acquisition 字段及 claim index。历史行 NULL，不回填/自动入队，不新建另一套 provider receipt 表，不修改前 48 个 SQL；旧 unique/retention/restrictive FK 保留。
- Worker 运行于既有 execution-worker/all 角色，test 不自动开 timer；SKIP LOCKED/独立 lease token/CAS、45s lease、最多 6 次尝试、10min receipt 时效，过期/清理/耗尽任务终止。支持内部 connection partition，测试仅 claim 新建的自有连接；后台仍 claim 全队列，不清空旧测试数据来制造通过。
- 真正读取通过 `Connections.invokeConsumerRead → existing Provider Runtime → actual adapter` 完成。外部 GET 不放入 admission/Truth 锁事务；实际资源 ID/number/repository 校验及当前 lease 校验在任何 Observation 物化之前进行。服务器 acquisition proof 携带内部 receipt/lease token，既有 Generic v2 授权事务再次复核凭据版本、Grant、Health 和边界，并锁定 receipt 至确认提交；等待锁后重新取当前时间，复核 token/状态/时效/hintHash/capability，封住 precheck → Truth 事务间的接管窗口。普通直接 API READ 不携带 lease，保持旧路径；公开 confirm API 仍不能注入服务器 proof。已撤权/旋转/资源错配/提示损坏/租约失效不确认 Truth。
- 相同状态仅 revalidate 可变父记录，保持旧 Version/Provenance 不可变；实际状态变更追加既有 Version。worker `READ_BACK_COMPLETE` 仅表示此刷新提示已完成 API 回读，不是外部写动作的 SUCCEEDED；冲突 Truth 标 BLOCKED。失去连接只允许排期再 READ；不存在 POST、自动 hook 创建、admin 能力或自动再发写请求。
- HTTP 异常保留现有 Connector error mapping；worker 只识别允许的安全 retryable providerCode，不从错误消息/SQL 推断状态。429/Retry-After 保守排期，不清理 cooldown 或扩大应用预算；原有 Health/限流门禁照常执行。排期读取恢复前复用 existing Connections.validate Health 生命周期，实际凭据/身份/Scope/CAS 复核和探测本身也受 Runtime 限流；恢复不依赖人工 validate。普通接管/首读不额外探测，只有之前 transient failure 的排期 retry 使用该恢复路径。
- 新发布 github Manifest@3 / Evidence@2 / RuntimePolicy@2，并保留 github@2/@1/@1 历史定义。支持 signed hints 不代表 broad repo Scope 等于已创建 hook；`webhookConfigured` 与 `realAccountAcceptance=NOT_VERIFIED` 分开展示。

依据已核对的 [GitHub payload 文档](https://docs.github.com/en/webhooks/webhook-events-and-payloads) 与 [Webhook 最佳实践](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) 实施。没有推测未实现的官方写入幂等能力。

## 已运行门禁

最终专项 **6 文件 / 84 项通过**（18:00:09，37.80s）：新 hint unit 17、HTTP/non-Secret/lease-proof contract 12、实际 adapter TCP/HTTP/MySQL Webhook 19、既有 GitHub unit 14、既有 TCP/MySQL 15、Migration contract 7。

隔离测试覆盖 raw bytes/重新 stringify/缺 Secret、非法 UTF8/JSON/超限/unsafe ID、header-body mismatch/歧义、foreign repo/URL/base repo、ghost/fork 边界、6并发 replay仅1receipt、4并发 claim仅1lease、已有双身份碰撞、owned receipt GET、实际 Issue/PR/Workflow API 状态优先于 signed payload、ID 错配/提示 hash 损坏不摄取、相同状态/变化状态、GET 中撤权或旋转、租约接管旧 worker 不发布/覆盖、网络恢复纯 READ、429 单次请求及延迟、过期/清理/耗尽、已接受排期任务撤权后不 GET。保留既有一条真实 TCP 副作用已产生后断网、并发 Outbox/Reconciliation 不重复 POST 用例；不是在真实 GitHub 上产生副作用。

最新本地 build **8/8**（23.91s）、typecheck **8/8**（16.119s）；49 migration safety/destructive=0、Drizzle segmentation、测试库前向 migrate、data:truth、repository:hygiene（669文件）通过。MySQL 8.4.11 核验通过，测试 schema 的 drizzleMigrationCount=49，证据 `.data/batch-9d-webhook-mysql84-evidence.json`。依赖审计在 npmmirror 无 audit endpoint 时改用 npm 官方 registry 重试，结果无已知生产依赖漏洞，没有更改 lockfile/依赖配置。

最新源码 Full API **89文件通过/1既有跳过、654项通过/4既有跳过（658总项）**，18:03:03 开始、500.86s 完成；Monorepo **16/16**（8m46.303s）。独立 main/远端 CI 待验收，不能以本地通过或旧基线 #68 替代本增量的远端/Android 证据。历史回归分别为补 lease fence 前 647项通过/4既有跳过、Monorepo16/16（8m6.591s），补 fence 后 651项通过/4既有跳过、Monorepo16/16（7m41.779s），Health 恢复后 652项通过/4既有跳过、Monorepo16/16（9m34.091s），初次到期修正后 653项通过/4既有跳过、Monorepo16/16（8m39.663s）；这些只保留为历史过程证据。

网络恢复测试已移除人工 validate。新增提前 dequeue 用例发现 HTTP READ 的 Retry-After 保存在连接级协调器，而 Health 的 Runtime 门禁使用另一个命名空间；恢复现在先复核连接未撤销，再经过同一个连接级协调器，然后进入现有 Health/Runtime 生命周期。该用例验证 cooldown 期间包括身份探测在内的网络 GET 数量不变、维持 RETRY/RATE_LIMITED 和保守 Retry-After；随后撤权优先终止为 BLOCKED。SDK 原始限流错误（providerCode 可为空）与 HTTP 映射错误按明确 code/category/retryable 分类，不依据消息猜测，不清除 cooldown。

新增真实 MySQL Grant 锁等待回归先复现到期后错误 READ_BACK_COMPLETE（`.data/batch-9d-webhook-expiry-red.log`），再验证修正后 BLOCKED。较晚 Candidate 锁等待进一步复现同类问题（`.data/batch-9d-webhook-late-lock-red.log`）。统一期限检查现在在 receipt 锁后、所有 Candidate/Manifest/Truth 锁后和 Audit 等待后事务返回前调用，检查 connection、legacy permission、Grant、credential 的 expiresAt，以及 receipt lease/retention、Health 时效；不复用旧时间判断期限。等待耗尽期限时所有 Truth/Version/Provenance/Wakeup/Audit 追加一起回滚。两个锁等待场景均通过；只扩展带 acquisitionLease 的服务器发布路径，不改普通直接 READ 契约，不重写旧 Version/Provenance/Registry。

普通失败已定位修正：disabled connector 复用 prototype metadata 的兼容问题；撤权测试错误地在 429 导致连接错误后再要求 admission；共享测试数据库中的旧队列任务导致全局 claim 的计数混杂。后续代码复查补了 precheck 之后、实际 Truth 事务之前的 lease takeover fence；新增实际 TCP/MySQL 并发测试在这个窗口暂停确认并接管租约，旧 worker 不能确认 Truth/覆盖新 lease，后继正常回读。没有绕开 fail-closed/限流、删除历史任务或恢复生产数据；connection-scoped claim 保留后台全队列行为。没有更改已发布的 Normalizer/Conflict Policy 或既有不可变 Version。

最新日志：`.data/batch-9d-webhook-publication-focused.log`、`.data/batch-9d-webhook-publication-build.log`、`.data/batch-9d-webhook-publication-typecheck.log`、`.data/batch-9d-webhook-publication-monorepo.log`。历史日志保留 `.data/batch-9d-webhook-expiry-monorepo.log`、`.data/batch-9d-webhook-final-monorepo.log`、`.data/batch-9d-webhook-fenced-monorepo.log` 与 `.data/batch-9d-webhook-monorepo.log`。旧基线自己的独立远端 #68 与 artifact digest 已记录于 [连续 Truth report](./runtime-productization-batch-9d-versioned-truth-report.md)，不作为本次新增源码的远端证据。

## 未完成

2026-09-14 后续基线收口：`main@fdfc2c18f194ed2df214268d58659fae022d2a83` 的独立 [CI #69](https://github.com/964896765/lazy-armor/actions/runs/34832033652) 已 completed/success。Fast `103937335407`、RC Full `103938023993`、Android `103938024091` 均成功。同 SHA artifacts 未过期：MySQL `10342089541` / `sha256:6b0737e64ae6ebce7af8a868a2a8fa35248a5d1c146485571468cc86508da7d6`；Android `10344905095` / `sha256:895aed39a6f9d1542d2e7dd7ed882b2f40100544f6b91e09396edbeb7bb863a9`。这是 Signed Webhook 基线证据，不是之后新增 handoff 源码或真实账号 Journey 的验收。

PR SILENT_FOLLOW_UP 的版本化 Scenario/Fact 投影、terminal Condition、当前 Truth/Grant dispatch guard 和既有 Execution 通知 handoff 仍待实现。现有 96 场景/Readiness 不自动升级，不手工伪造依赖，也不把 PR 当 EmailMessage。没有证明带真实 Strategy 依赖的 PR 通知去重 Journey，本次只验证现有 Generic Truth 版本去重/追加；不能用“没有额外版本”代替完整 Strategy/Execution Journey 验收。

没有真实账号 OAuth/repository hook 交付、真实 token 权限/429/撤权、真实 Issue/Comment 写后验收、Notion/cross-provider Journey 或 Android 真机验收。只有相关真实账号链路受 Secret/授权验收阻塞，其余 9D → 9E/9F → Batch 10/11 按总规划继续。不得标整个 9D 或 Runtime `FULL GREEN`。
