# Batch 9E — Notion 非 Secret 实现与隔离验收报告

日期：2026-09-15。基线：当前最新 `main@9d581f5` 增量开发，不回退 `fdfc2c1`。状态：非 Secret 产品实现和本地隔离验收完成；真实 Notion workspace/OAuth/限流/撤权验收因未配置真实 Secret 与账号授权而保持独立 Hard Stop，Batch 9E 不标记为真实平台关闭。

## 交付结果

- 配置契约严格校验 `NOTION_OAUTH_CLIENT_ID / NOTION_OAUTH_CLIENT_SECRET / NOTION_OAUTH_REDIRECT_URI`，仅接受 HTTPS、固定 callback、无 query/hash/userinfo 的完整配置；缺失或占位值在生产环境 fail-closed。
- 新增 Notion OAuth authorize/callback/refresh/revoke/introspect，复用现有 state/CAS、Connection、Credential 加密与单调旋转边界；根据 introspection 的实际 scope 和 workspace/bot identity 生成 Grant，不从“OAuth 成功”推断能力。
- 发布 `READ_PAGE / READ_DATA_SOURCE / CREATE_PAGE / UPDATE_PAGE` 的 Manifest revision 3、Evidence revision 1 和 VerificationPolicy revision 2。Provider Availability、Implementation Reality、Connection Grant、Runtime Health 与资源可访问性分别建模。
- HTTP client 固定 `https://api.notion.com` 与 `Notion-Version: 2026-03-11`，采用精确 method/path allowlist、超时和响应体上限；写请求显式标记且禁止隐式重试，429/权限/冲突/网络歧义映射到统一错误语义。
- Page/DataSource 读取经 `SourceObservation → document-resource parser/normalizer → CandidateFact → Versioned Truth`；复用 Generic Reality Pipeline 与现有 Truth version/lease fence，不建立 Notion Truth Engine。
- Page 创建/更新只接受有界结构化属性，预检真实 parent/schema；写路径为 `ActionIntent → Risk R3 → Approval → Resolver → Existing Execution/Outbox → Read-back Verification`。创建后无 page ID 的网络歧义保持 `OUTCOME_UNKNOWN`，不重复 POST；已知 page ID 的更新允许只读 Reconciliation 收口。
- Notion 模块启动时把新 revision 同步安装到进程内 Capability Registry，避免数据库已发布而 Resolver 仍读取旧 skeleton 的分裂状态。

## 数据库与迁移

本 Batch 复用已有 provider manifest/evidence/policy、connection/grant/health、OAuth state/credential、observation/candidate/truth、execution/outbox/verification/reconciliation 表，无需新增 DDL。`migration:safety` 验证现有 50 个 migration 无 DROP/TRUNCATE，并保留已发布 revision 的不可变历史；本地持久库曾发布的旧 revision 不删除，后续以 revision 3/2 单调前进。

## 验收证据

- Config contract：12 passed。
- Notion foundation：15 passed。
- TCP/HTTP/MySQL live adapter integration：4 passed，覆盖 3 路并发 OAuth callback 仅一次成功、实际 scope grant、Page/DataSource 并发观察去重、CREATE_PAGE 既有执行与写后验证、UPDATE_PAGE 已产生副作用后断网、并发 worker 不重复执行、Reconciliation 只读收口。
- Full API：91 files passed / 2 skipped；700 passed / 5 skipped。
- `migration:safety`、`data:truth`、全仓 typecheck（8/8）和 build（8/8）通过；全仓 test、DB RC、依赖审计与远端同 SHA 门禁以提交后的持续验收记录为准。

## 未关闭项与下一步

真实 Client ID/Secret、真实 workspace 和授权账号未提供，因此没有执行真实 OAuth、scope/resource permission、token refresh/revoke、429、真实写入/read-back；不得写成“真实 Notion 已完成”。非 Secret 主线继续进入 Batch 9F：保留已存在的 Gmail → Calendar Journey，并新增 GitHub Truth → deterministic Condition → Notion Existing Execution → Verification → Record，证明共享 Fact、Resolver、Execution 与 Verification。
