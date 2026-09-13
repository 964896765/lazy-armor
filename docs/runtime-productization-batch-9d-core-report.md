# Batch 9D — GitHub OAuth / 五项能力 / Generic Truth / 写后对账核心子步骤

日期：2026-09-13；代码基线 main@02e77bd74d51024444450aa56bceba4417066245。**这是 9D 核心非 Secret 接入的阶段报告，不是整个 9D 完成报告，更不是真实 GitHub 账号验收。Webhook ingestion 和 PR SILENT_FOLLOW_UP Journey 未完成，9D 不关闭。**

## 实现与安全边界

独立 GitHub OAuth 配置和精确 HTTPS callback；S256 PKCE；state/一次性 callback/CAS/凭据单调版本复用现有 Connections 与 Credentials。回调 HTTP 桥复用 GoogleOAuthSessions 的平台无关存储逻辑，不复用 Google Client Secret 或 token endpoint，不新增认证表。拒绝未授权 callback、宽松 redirect、失败/取消后的再次 exchange。

GitHubHttpClient 固定 github.com token endpoint / api.github.com REST，固定 REST 2026-03-10，禁用 redirect 和 adapter 隐式重试。支持 JSON object / array / 204；4 MiB 正文上限和 10 秒请求全程 deadline 包含正文读取。本地安全上限不是官方 quota。HTTP 403/429 分开识别 primary/secondary limit，等待取服务端时间证据较晚值，secondary 无时间证据至少 60 秒；错误正文/Token/Secret 不向 API 调用者输出。写后网络故障、正文损坏或超时不证明无副作用。

首版只接 OAuth App；请求 repo + offline_access。repo 是 classic OAuth 私有仓库访问所需的较广 Scope，不声称 fine-grained/App/PAT 已支持，不把 X-Accepted-GitHub-Permissions 或 repository.permissions.push 当实际 Grant。token response 的实际 Scope 与 GET /user 的 X-OAuth-Scopes 必须一致；每次 exchange / refresh 校验实际数值 user ID，refresh 不能扩大 Scope 或混入另一个账号。过期 Token 必须有完整实际旋转后的新 access/refresh pair；非过期 Token 不伪造 expiry/refresh。撤权只 DELETE 当前 app token，不撤销所有授权或关联 SSH keys。

OAuth 认证后最多发现第一页 100 个实际授权 Repository，凭据内存储实际 id + canonical owner/name。不会宣称覆盖全部仓库；未在快照内的目标 fail-closed，新增/更名仓库需要后续重新授权发现。每次 read / write / reconciliation 都校验实际账号、Scope、目标 repository ID 与名称；不能用 owner/repo 字符串代替账号/资源权限证明。

READ_ISSUE、READ_PULL_REQUEST、READ_WORKFLOW_STATUS、CREATE_ISSUE、CREATE_COMMENT 已实现。Issue endpoint 列表混入 PR 时不当作 Issue；PR list 的实际 merged_at 与 detail merged 证据按官方字段正常化。Repository / Issue / PullRequest / Workflow 与 repository.metadata / issue.state / pull_request.state / workflow.run_status additive 注册到现有 Resource / Fact Catalog。connectionId + repositoryId + resourceType + resourceId 隔离语义身份，Generic parser/normalizer/freshness policy 汇入现有 SourceObservation → CandidateFact → Truth/Provenance/Truth Version/Strategy enqueue，不创建 GitHub/Issue/PR Engine，不增加 96 Scenario 数量，不自动升级场景 Readiness。

写入仅接受不可变批准上下文 triggerPayload.githubAction：repository(id/owner/name)、visibility(private/public)、body，以及 CREATE_ISSUE 的 title 或 CREATE_COMMENT 的 issueNumber/targetKind(ISSUE/PULL_REQUEST)。目标实际可见性不同、类型不同、Scope/身份不足、未绑定仓库均在 POST 前拒绝。Risk Floor R3；沿用现有 publish action 容器、Risk、Approval、Resolver、Execution/Outbox、Verification。通用 publish 的 visibility 配置不替代 GitHub 的批准资源可见性，适配器不会发送该容器配置作平台参数。没有直接写 API，也不自动创建 webhook 或扩大管理权限。

操作标记仅用于相关性和有界 GET 回查，不宣称 GitHub idempotency key/ exactly-once。每次最多一条 POST；收到 issue number/comment ID 后回读，并比对记录 ID、目标、批准 title/body、实际 author ID 和完整 marker。POST 成功后 GET 403/404、ID 不同、响应损坏等进入 OUTCOME_UNKNOWN。只读 Reconciliation 最多扫描一页 100 条候选再回读；缺失/多个完整匹配均保持 UNKNOWN，不能再次 POST。Repository 可见性变化时 reconciliation 不误报完成。

## API 与运行时

- GET /api/providers/github/status：认证保护，真实账号始终 NOT_VERIFIED；未配置时 DISABLED。
- POST /api/providers/github/authorize：认证保护，现有 OAuth state/PKCE。
- GET /api/providers/github/oauth/callback：仅 HTTPS，精确 query、state/CAS、no-store/no-referrer；不会返回凭据。
- POST /api/providers/github/connections/:id/observations：仅当前拥有者、只读 Capability，真实 API 结果进入 Generic Truth；不接受客户端伪造 payload。
- 写入继续走已有 Plan Execution / Approval API，不新增绕过审批的 Provider 写路由。

生产缺 Secret 使用 DisabledGitHubConnector，不注册可执行 fixture。NODE_ENV=test 且无 GitHub 配置时保留既有 8 connector / 18 skeleton 的历史隔离契约，新的实际 Adapter 专项显式配置隔离 transport 后单独验收。ProviderAvailability、Implementation、Grant、Health 仍分别来自正式 Registry/用户连接/运行时，连接成功不是所有能力可用的证明。ConnectionsService 的故障 Health 投影从 Google 两项白名单扩展为现有 ProviderConnectorBridge 类型，不重写 Risk/Approval/Execution/Verification。

Schema/Type 已包含 GitHub config、transport、OAuth、批准写入结构、资源/Fact、parser、Manifest/Evidence/Policy。DDL Migration **N/A**：复用已有 OAuth state/Credentials/Provider Registry/Resource-Fact Catalog/Observation-Candidate-Truth/Verification/Outbox 表；既有 47 个 migration 未修改，禁止 DROP/TRUNCATE。Manifest github@2、Official Evidence@1、Runtime Policy@1 与两项 readback policy@1 均按已有不可变 revision 机制持久化。后续扩展（特别是 webhook）需要新 revision，不能修改已发布定义。

## 已执行门禁

联合专项 **10 文件 / 130 项通过**（18:29:11，34.96s）：GitHub HTTP 25、OAuth 21、Provider 14、真实 Adapter TCP/MySQL 9、raw-byte signature 12；Calendar/Gmail/migration 49 项联合回归。GitHub TCP/MySQL 包括四 callback 一次 exchange、拒绝未授 Scope/他人连接、并发读取去重为唯一 Candidate/Truth、真实 PR/Workflow 响应、R3 审批与写后 Evidence、一次副作用后断开 TCP / 并发 Outbox / 并发只读对账 / 重投不重复 POST、实际 pair refresh、secondary HTTP 403 冷却及冷却中撤权。

普通失败直接修复：首次专项因限流用例在写入之前执行，真实共享冷却正确阻止了后续操作。重新安排验收顺序后通过，没有删除冷却、清理生产 limiter 状态或改弱 Runtime。部分初次 typecheck/专项失败为新增 import/内部包旧 dist，补 import/重建后复测。

最终 typecheck **8/8**（17.909s）；build **8/8**（18.74s，API 非 cache）；migration safety **47 files/destructive=0**、Drizzle segmentation、production data truth、依赖审计（无已知漏洞）通过。最终 Full API **85 文件通过 / 1 文件跳过；592 项通过 / 4 项既有跳过，共 596 项**（18:46:17，509.14s）；Monorepo **16/16**（8m55.184s）。真实 MySQL integration、并发、迁移与 API contract 包含在本次完整回归中；没有真实 GitHub 账号测试。

增量已 stage 后 repository hygiene **656 tracked files**、cached diff whitespace 与 47 个 migration replay 通过。首次 Full API 的唯一失败来自旧目录测试写死 parser/normalizer 数量；改为逐项验证正式 Registry 的 key/revision/不可变 hash 和唯一持久化记录，单项 DB 专项 5/5 通过，再完整重跑得到上述 592 项通过。没有删除历史 Registry、放松 hash 校验或将目录扩展误判为运行时失败。

日志：`.data/batch-9d-core-focused.log`、`.data/batch-9d-registry-regression.log`、`.data/batch-9d-core-typecheck-final.log`、`.data/batch-9d-core-build.log`、`.data/batch-9d-core-monorepo-final.log`；首次失败日志 `.data/batch-9d-core-monorepo.log` 保留。Config 的独立 51 项证据与既有预备子步骤见 [foundation report](./runtime-productization-batch-9d-foundation-report.md)。远端 Calendar #66 只支持其自己的 SHA，不作为 GitHub 新源码远端证据；本次 GitHub 推送后的远端门禁需要独立核对，不提前标远端全部通过。

## 未完成项与连续开发顺序

raw-byte HMAC primitive 已测试，但完整 signed Webhook ingestion（连接/资源/事件语义/撤权/变更 delivery header 重放/DB 并发）**未实现**，metadata.supportsWebhook=false；PR 状态变化 → Truth → SILENT_FOLLOW_UP → merged/failed 通知 Journey 未完成。接着补齐上述非 Secret 功能和隔离 Journey，再接 9E Notion、9F 跨 Provider 验收；真实 Secret 缺失只阻塞相关账号验收，不中止其他开发。

已核对下一 Journey 的实际映射缺口：当前 ScenarioPlanCompiler 仍使用 catalog scenario 的 requiredFacts，SILENT_FOLLOW_UP 默认 OBSERVE/record；不能将 pull_request.state 伪装成 EmailMessage 的目录事实，也不能把任意字段或 updatedAt 变化当 merged/failed。后续应以增量、版本化的 Scenario/Fact 映射及 terminal Condition 复用现有 Operator/Strategy/Condition/Execution，使正常阶段仅记录、terminal 状态才通知；不改变历史 PlanVersion/Scenario/Binding hash，不另造 PR Engine 或手工伪造依赖。

进一步核对 Generic Pipeline：当前 confirmCandidate 对不同值的 Candidate 新建 Truth Record/version 1，同一 Candidate 的并发确认可去重，但尚不等于同一 PR 的连续版本链。PR Journey 需要增量接入稳定事实身份和既有 Truth Record/Truth Version 的追加机制，再评估 CHANGED/terminal 条件；不能把独立快照声称为已验证的连续状态变化。历史 billing/notification、PlanVersion、Audit 与已保存 Truth Version 不重写、不回填猜测身份。

真实 GitHub OAuth/Token 权限、repository webhook、限流、撤权与实际创建测试 Issue/Comment 尚未验收。不得关闭 9D、不得标真实 GitHub 已完成/FULL GREEN。

官方来源：[OAuth/PKCE/expiring tokens](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)、[OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)、[REST versioning](https://docs.github.com/en/rest/about-the-rest-api/api-versions)、[Issues](https://docs.github.com/en/rest/issues/issues)、[Comments](https://docs.github.com/en/rest/issues/comments)、[Pull Requests](https://docs.github.com/en/rest/pulls/pulls)、[Workflow runs](https://docs.github.com/en/rest/actions/workflow-runs)、[Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[Current-token revoke](https://docs.github.com/en/rest/apps/oauth-applications)。
