# Batch 9D — GitHub 接入边界与差异验收设计

日期：2026-09-13；状态：9C 全量回归期间开始官方合同核对与非 Secret 设计，**不是 GitHub Adapter 完成报告或真实账号 Journey 证据**。9B/9C 缺真实 OAuth Secret 不阻塞此设计。

## 公共运行时不变

复用 Connections/OAuth state CAS、Credentials/单调 version、ProviderRuntime/CapabilityResolver、Generic Observation/Candidate/Truth、Strategy Runtime、Risk/不可变 Approval、Existing Execution/Outbox、Verification/Reconciliation。不创建 GitHub Engine、Issue Engine、PR Engine，或第二套认证/事实/审批表。GitHub Client 配置不复用 Google client credentials；可共享的是已有状态存储和 HTTP callback 安全模式，而不是平台 Secret。

## 第一版能力与资源

READ_ISSUE、READ_PULL_REQUEST、READ_WORKFLOW_STATUS、CREATE_ISSUE、CREATE_COMMENT。Repository/Issue/PullRequest/Workflow 按官方 REST 资源正常化，以 connectionId + actual repository ID + resource ID 为语义标识，owner/repo 名称仅为已验证路由而非跨账号授权证明。写操作固定批准的 repository/issue number/title/body，先验证目标资源属于该授权连接，再调用唯一一次 POST；回复 issue/comment ID 后 GET 回读，比对批准字段、实际资源身份与操作相关性。

权限必须按 token 类型区分：fine-grained Issues read/write、Pull requests read/write、Actions read，与 classic OAuth Scope 不是同一概念；read access 不证明 write access。X-Accepted-GitHub-Permissions 是 endpoint 所需权限的提示，不是 token 已获授权证据；repository.permissions.push 也不能替代 fine-grained Issues write。无法核实 token 权限的写能力 fail-closed，不猜测 Grant。OAuth token response 与官方 scope/header 证据、用户明确授权、实际 target repository access 分层保存，不能把 token 可登录当成五项能力都可用。初版认证方式与精确配置会在实现报告中冻结；fine-grained/App 模式未经实现与差异验收不宣称已支持。

GitHub OAuth 现行官方文档支持 S256 PKCE；复用既有 state/一次性 token exchange 的安全边界，但 GitHub 自己的 authorize/token/revoke endpoints、body 格式、Scope/身份校验必须由其 adapter 实现，不直接套 Google HTTP client。

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
