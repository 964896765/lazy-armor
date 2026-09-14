# Batch 9D — GitHub 接入边界与差异验收设计

日期：2026-09-13；状态：9C 全量回归期间开始官方合同核对与非 Secret 设计，**不是 GitHub Adapter 完成报告或真实账号 Journey 证据**。9B/9C 缺真实 OAuth Secret 不阻塞此设计。

## 公共运行时不变

复用 Connections/OAuth state CAS、Credentials/单调 version、ProviderRuntime/CapabilityResolver、Generic Observation/Candidate/Truth、Strategy Runtime、Risk/不可变 Approval、Existing Execution/Outbox、Verification/Reconciliation。不创建 GitHub Engine、Issue Engine、PR Engine，或第二套认证/事实/审批表。GitHub Client 配置不复用 Google client credentials；可共享的是已有状态存储和 HTTP callback 安全模式，而不是平台 Secret。

## 第一版能力与资源

READ_ISSUE、READ_PULL_REQUEST、READ_WORKFLOW_STATUS、CREATE_ISSUE、CREATE_COMMENT。Repository/Issue/PullRequest/Workflow 按官方 REST 资源正常化，以 connectionId + actual repository ID + resource ID 为语义标识，owner/repo 名称仅为已验证路由而非跨账号授权证明。写操作固定批准的 repository/issue number/title/body，先验证目标资源属于该授权连接，再调用唯一一次 POST；回复 issue/comment ID 后 GET 回读，比对批准字段、实际资源身份与操作相关性。

当前 Resource Catalog 尚无 Repository/Issue/PullRequest/Workflow 的正式定义；后续必须 additive 注册这些通用资源及其 Fact Schema，不能把 PR/workflow 强行塞成 EmailMessage/CalendarEvent/Task 的同名事实。Provider skeleton 的 work.repository 仅为候选能力提示，不替代 ResourceDefinition。96 个 Scenario 数量与已有定义不因新增 Provider 增长；Wave 1 再逐个检查它们是否真正有满足 Required Facts 的来源，不因为目录新增资源就自动升级 Readiness。

权限必须按 token 类型区分：fine-grained Issues read/write、Pull requests read/write、Actions read，与 classic OAuth Scope 不是同一概念；read access 不证明 write access。X-Accepted-GitHub-Permissions 是 endpoint 所需权限的提示，不是 token 已获授权证据；repository.permissions.push 也不能替代 fine-grained Issues write。无法核实 token 权限的写能力 fail-closed，不猜测 Grant。OAuth token response 与官方 scope/header 证据、用户明确授权、实际 target repository access 分层保存，不能把 token 可登录当成五项能力都可用。初版认证方式与精确配置会在实现报告中冻结；fine-grained/App 模式未经实现与差异验收不宣称已支持。

GitHub OAuth 现行官方文档支持 S256 PKCE；复用既有 state/一次性 token exchange 的安全边界，但 GitHub 自己的 authorize/token/revoke endpoints、body 格式、Scope/身份校验必须由其 adapter 实现，不直接套 Google HTTP client。

后续认证实现以 OAuth App 为首条模式；classic OAuth Scope 与 fine-grained/App 模式分开，不将后者提前标支持。按授权目的选择最窄 Scope，实际 token response/官方 Scope 校验决定 Grant；[OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) 中 repo/public_repo 均含写权限，不能因为 Scope 较广就跳过产品端 R3 审批和 resource boundary。expiring token / offline_access 模式只有实际 refresh_token/expires_in 到位才标支持 refresh；非过期 token 不伪造 refresh_token。每次交换或 refresh 后重新 GET /user 校验实际身份。只撤销当前 app token，不用 delete-all-app-authorization 扩大撤权副作用，参考 [token revoke](https://docs.github.com/en/rest/apps/oauth-applications)。

GitHub 现行 OAuth 文档说明旧 callback 可能默认开启 wildcard matching；真实部署必须关闭 wildcard 并注册精确 HTTPS callback。客户端和后端仍独立做精确 redirectUri/state/PKCE 校验，不依赖平台的宽松匹配作为安全保证。

## 限流与未知结果

Primary / secondary rate limits 分开识别，403 不一律当永久权限失败；429/403 + Retry-After / X-RateLimit-Remaining / X-RateLimit-Reset 参与标准 Error Mapping 与 Health。只读有限重试，写入不在 adapter 内重试；遵守 Runtime request budget 与服务端等待信息，不通过立即重试绕过 secondary rate limit。应用预算不是 GitHub 官方 quota 的声明。

Issues POST 与 comments POST 会产生公开内容/通知副作用，Risk Floor 至少 R3。网络断开/无有效 ID/写后 GET 失败进入 OUTCOME_UNKNOWN。操作标记仅用于纯 GET 有界回查和完整批准字段比对，不宣称 GitHub 支持未经证实的 idempotency key；查不到不代表一定没写入，不能借 Reconciliation 再 POST。

## Webhook

先验证原始请求字节的 HMAC SHA-256 与 X-Hub-Signature-256，常量时间比较；缺 Secret、缺签名、正文被修改、已撤权均拒绝。禁止用 JSON re-stringify 后的内容验签。repository.id 必须绑定当前授权目标；payload 结构和 action 必须符合允许事件，不信任可伪造/不在 HMAC 内的 header 去改变资源身份或事件含义。

按 X-GitHub-Delivery + payload hash/资源语义做重放与并发去重，同一 signed body 更换 delivery header 也不能制造新 Truth 或重复下游动作。只订阅实现所需的 issue/pull_request/workflow_run，不新增创建/管理 webhook 的未授权生产 API。真实 repository webhook 配置与权限验证属于独立真实验收。

## Golden Journey 与门禁

优先 PR 状态变化 → authenticated/signed Observation → Generic Truth → SILENT_FOLLOW_UP → merged/failed 后通过已授予的通知 capability 通知；不是另造 PR 工作流 Engine。其次批准创建 Issue/Comment → Existing Runner → read-back Evidence → Record，覆盖批准后撤权、429、网络断开、并发不重发。仓库更名、issue endpoint 混入 PR、资源权限不足及 webhook 错误签名均有拒绝用例。

实现须同步 Schema、必要增量 migration 或 N/A、Service/API、Unit、TCP/DB、Concurrency、Contract/Migration、Full API、Monorepo、Typecheck；真实测试 repository 与 token/OAuth Secret 到位后再验证真实 Journey。当前连接本仓库的 Codex GitHub 插件只用于仓库/CI 检查，不是本产品 GitHub Provider 的实现或用户授权验收证据。

## 已核对的官方来源

- [OAuth App flow / S256 PKCE](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Fine-grained token permission mapping](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [Issues REST API](https://docs.github.com/en/rest/issues/issues)
- [Issue comments REST API](https://docs.github.com/en/rest/issues/comments)
- [Pull requests REST API](https://docs.github.com/en/rest/pulls/pulls)
- [Workflow runs REST API](https://docs.github.com/en/rest/actions/workflow-runs)
- [Primary/secondary rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [Webhook signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

## 已开始代码落地：配置与验签基础

独立 GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET / GITHUB_OAUTH_REDIRECT_URI，回调契约为 HTTPS + 精确 `/api/providers/github/oauth/callback`。三项全缺时独立禁用，部分/占位/不安全 URI 在 parseEnv 期间 fail-closed。GITHUB_WEBHOOK_SECRET 可独立缺失；显式设置时要求非占位、至少 32 字符。该配置**尚不启用 GitHub Adapter 或 HTTP webhook endpoint**，不能宣称 OAuth/实际 Grant 已完成。

verifyGitHubWebhookSignature 只提供 raw Buffer 的 HMAC SHA-256 常量时间比较和 deliveryId/payloadHash；本地正文安全上限 1 MiB，不声称这是 GitHub 官方最大体积。非原始字节、重新 stringify、空/超大正文、错误签名或缺 Secret 均拒绝。delivery header 不在 HMAC 内，替换 header 的同一 body 保持相同 payloadHash；后续 ingestion 必须将其用于资源/语义去重，而不能只按 deliveryId 去重。

此步骤未实现目标 repository/active connection 校验、完整签名 webhook ingestion、5 项 Capability 的 Adapter/执行与 Truth Journey。不得把验签 primitive 单元测试当成 webhook 并发/真实平台验收。预备子步骤证据见 [9D foundation report](./runtime-productization-batch-9d-foundation-report.md)，不表示 Batch 9D 关闭。

## 后续实际核心实现

上述描述是 foundation 子步骤的历史边界。现已继续实现 OAuth App transport/PKCE/Scope/身份/refresh/revoke、五 Capability、实际授权仓库快照、批准资源可见性、Generic Resource/Fact/Truth、现有 R3 Approval/Runner 与纯 GET 对账，并通过联合专项 130 项。准确当前边界与完整门禁见 [9D core report](./runtime-productization-batch-9d-core-report.md)。Webhook ingestion 与 PR SILENT_FOLLOW_UP Journey 仍未完成，不能仅凭五项 Adapter 和验签函数关闭 9D。已持久化的 Manifest/Evidence/Policy 不可变，后续 webhook 扩展使用新 revision。

## 2026-09-14 Webhook ingestion 落地设计（待实现，不是验收）

连续资源 Truth v2 的实现与独立测试见 [versioned Truth report](./runtime-productization-batch-9d-versioned-truth-report.md)。下一子步骤冻结以下边界，尚未启用 endpoint/worker，supportsWebhook 仍 false：

1. Admission 只接受精确 HTTPS 路由与 JSON raw body，复用现有 captureRawBody 和 256 KiB HTTP 安全上限；不能扩大普通 API body budget。raw SHA-256 HMAC 校验在解析/存储之前完成。event/action 必须同时匹配 signed body 的允许结构；Delivery/Event/Hook-ID header 不在 HMAC 内，不能单独证明资源授权。sender 不是当前连接拥有者的证明，不能拒绝合法 ghost 事件后转而信任 sender 进行授权。
2. Signed body 仅作为刷新提示，不直接确认 payload 中的 state/merged/conclusion 为 VERIFIED Truth。提示只保留目标 repository ID/规范名称、Issue/PR number 或 run ID、实际资源 ID、action 与 hash；不保存原始 title/body/token。连接、READ Capability、实际仓库快照及 Grant 在 admission 和真正读取/发布时都检查。先通过已有 Provider Runtime 执行有权的 API GET，再比对实际资源 ID，最后由 Generic v2/现有 TruthVersion 追加；缺 Secret/撤权/权限变化均 fail-closed。
3. 复用现有 webhook_receipts 两个 unique identity：delivery 与 signed-body hash 均参与 connection-scoped 去重；相同 delivery 不同 body 拒绝，同 body 改 unsigned delivery header 命中原 receipt。存储成功才返回 accepted/PENDING，不假称已获取 Truth 或已完成 Journey。GitHub [最佳实践](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) 要求及时回复，网络回读放到异步 worker，不能等串行 GET 后才确认接收。
4. 通过前向 migration 为既有 receipt 扩展 nullable processing status/attempt/nextAttempt/lease/result metadata，历史行保持 NULL，不新增另一张 provider 专属 receipt 表。Worker 用现有角色机制与数据库 SKIP LOCKED/lease CAS，旧行不自动入队；读取重试受已有 RateLimit/Health/quota 和尝试上限约束，过期/冲突/撤权不假成功。进程中止后允许有权的只读刷新恢复，不创建或重试外部写动作。
5. Manifest github@2、Evidence@1、RuntimePolicy@1 已发布，不原地扩展 sourceModes/realtimeModes/fields。实现后发布新 revision，与实际能力差异测试一起落库；不自动创建 webhook、不新增未授权 admin API、不声称 broad repo Scope 等于已配置 webhook。
6. 隔离验收至少覆盖 raw bytes/重新 stringify/缺 Secret、事件头篡改与 signed body 不符、资源错配/歧义 body、header 变化重放、真实 DB 并发唯一 receipt、GET 中撤权/旋转、worker lease takeover、429/断线恢复、读取后连续 TruthVersion 与无重复 wakeup。真实 GitHub repository delivery 和账号授权另外验收，不用 isolation transport 关闭 9D。

PR 静默 Journey 需要版本化 Scenario/Fact 投影和 terminal Condition，不能篡改旧 96 场景或旧 binding hash。新 dispatcher 必须在 handoff 前复核当前 Truth 状态/版本、Grant/资源边界；conflicted/revoked/superseded version 不作为有效当前事实。历史 StrategyDecision/Audit 保持不可变，不能把旧 READY_FOR_PLAN_ENGINE decision replay 当成当前授权证据。现有 Operator/Strategy/Execution 重用，不以任意字段或 updatedAt 的 CHANGED 代替 merged/failed。

## 后续签名接收与只读 acquisition 实现

上文“待实现”保留为设计时历史状态。现已增量接入 HTTPS JSON raw-body endpoint、最小 refresh hint、既有 webhook_receipts 扩展、connection delivery/raw-hash 去重、SKIP LOCKED/lease CAS worker、真实授权 API 回读及 Generic v2。最终提示不保留 action/title/body/state/sender，只保留 schema/目标 repository/capability/resource ID/number/runId，并以 hintHash 做存储完整性校验；原始正文只在内存验签，不保存。共用 HTTP JSON parser 会做基本 JSON 解析，业务提示解析/保存前再验证捕获的原始字节 HMAC；没有改写公共 parser 或扩大 256KiB body budget。

新增 Manifest github@3、Official Evidence@2、RuntimePolicy@2；原 @2/@1/@1 定义保持不变。已实现的 supportsWebhook 不等于 signing Secret 已配置、仓库 hook 已建立或真实账号已验收。三类事件均只触发有权的现有 READ，不触发写入或绕过 Approval。准确测试和未完成边界见 [Webhook acquisition report](./runtime-productization-batch-9d-webhook-report.md)。PR 静默 Journey/既有 Execution handoff 与真实平台验收仍未完成。

## 下一子步骤：terminal 静默跟进的交接约束（设计，尚未实现）

当前代码复核确认：ScenarioPlanCompiler 默认只编译 canonical revision；SILENT_FOLLOW_UP@1 使用 CHANGED/OBSERVE；evaluateWakeup 会重放不可变历史决定，并未派发 Execution。因此接收 Webhook、追加 TruthVersion 或取得 READY_FOR_PLAN_ENGINE 都不能视为通知 Journey 已完成。

1. 使用注册且版本化的 Scenario 编译规则，显式绑定既有 PullRequest / Workflow Fact；保留原 96 个 canonical 场景、默认编译结果与 SILENT_FOLLOW_UP@1 hash，不接受客户端提供任意 AST/field/action 来伪造规则。只为新 PlanVersion 绑定 terminal 规则，旧 binding 不更新。
2. PullRequest 从实际 API Truth 的 `merged` 字段判断；Workflow 从实际 API Truth 的 `status` 判断 completed，再展示实际 `conclusion`。复用现有 EQ/CHANGED/逻辑 AST 与字段投影，不以 `updatedAt` 或整个对象 CHANGED 冒充 merged/failed。通知仅走 existing in_app Action/Runner，不新增外部发送权限。
3. 新交接入口将 Wakeup、Binding、StrategyDecision、TruthVersion、PlanVersion 和定义 hash 固定为服务器 proof。历史 READY 决策仍为历史记录；交接时必须重新检查 parent Truth 当前 version/status/freshness、实际 connection、当前 READ Grant/permission/credential/Health、repo/subject 与 active PlanVersion。历史决定不被改写为“现在已授权”。
4. 交接检查不能止于 dispatch 前的异步 precheck；最终检查与创建 Execution 必须在同一锁事务中完成，封住撤权/冲突/Truth version 替换/Plan 激活变更窗口。增量接入既有 Dispatch 的事务边界，不复制其 Risk/ActionIntent/Approval/Runner/Outbox。正常手动执行路径不携带 Strategy proof，保持现有契约。
5. 使用既有 Execution requestId unique identity 做 connection/plan/decision 作用域去重。并发或进程重启最多创建一条 Execution；失去租约的 worker 不覆盖后继，READY/已入队也不假称通知已完成。只有现有 Runner/Result/Audit 的实际结果可呈现完成。
6. 隔离 Journey 必须通过正式 Registry → Compiler → PlanVersion → Binding API 建立依赖，不能手工插入 truth_fact_dependencies。覆盖 open 静默、merged 通知、重复事件无重复 Execution、workflow completed/failed、旧 READY replay、handoff 前撤权/冲突/过期/旧版本、事务间并发变更和重启恢复；真实 GitHub hook/账号验收仍独立记录。
