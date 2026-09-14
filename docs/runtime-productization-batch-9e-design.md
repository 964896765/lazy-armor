# Batch 9E — Notion 接入差异与安全设计

日期：2026-09-14。状态：官方接口核对/设计，尚未实现真实 Notion Adapter，不计作 Batch 9E 完成。依次承接 GitHub terminal handoff；缺 OAuth Secret 仅阻塞真实 workspace 验收。

## 官方接口基线

- 固定 Notion-Version `2026-03-11`；public OAuth authorization code，state 防 CSRF，token/refresh/revoke 使用官方 HTTPS endpoint 与 Basic client authentication。现有 Connections/state/Credentials 单调版本与 fail-closed 边界继续复用；官方文档未证实的 PKCE/Scope 不能照抄 Google/GitHub。参考 [Authorization](https://developers.notion.com/guides/get-started/authorization)、[Revoke](https://developers.notion.com/reference/revoke-token)。
- 授权 workspace 与可访问 page/data source 是不同边界；OAuth 成功不证明全部资源或全部 Capability 可用。第一版只 READ_PAGE / READ_DATA_SOURCE / CREATE_PAGE / UPDATE_PAGE，采用 [Data Source](https://developers.notion.com/reference/retrieve-a-data-source) 而不是旧数据库对象假设。
- Page 属性与 block 正文不是同一接口/能力。第一版读取和写入有界结构化属性；不将属性读取宣称完整正文读取。写后必须用 page ID 再读取、比对 parent/批准 properties，并生成既有 VerificationEvidence；[Update page](https://developers.notion.com/reference/patch-page) 的字段契约为准。
- [Request limits](https://developers.notion.com/reference/request-limits) 映射 429/Retry-After；本地预算不是官方 quota。禁止 adapter 隐式 write retry；可能已产生副作用但没有 page ID 时保留 OUTCOME_UNKNOWN，只走既有 Reconciliation 的只读/用户确认路径。

## 待实施

配置契约与 HTTPS callback → HTTP/OAuth client → 四项 Manifest/Evidence/Policy 与权限/Health → 有界 Page/DataSource schema → 复用 Generic Observation/Candidate/Truth → 现有 ActionIntent/Resolver/Risk/Approval/Execution/Verification → 实际 HTTP/TCP/MySQL 隔离验收 → 真实 workspace 验收。新增定义使用新 revision，不能改已发布 skeleton；不创建 Notion auth/truth/execution 专属表或 Engine。
