# Batch 9E — Notion 接入差异与安全设计

日期：2026-09-14。状态：官方接口核对/设计，尚未实现真实 Notion Adapter，不计作 Batch 9E 完成。依次承接 GitHub terminal handoff；缺 OAuth Secret 仅阻塞真实 workspace 验收。

## 官方接口基线

- 固定 Notion-Version `2026-03-11`；public OAuth authorization code，state 防 CSRF，token/refresh/revoke 使用官方 HTTPS endpoint 与 Basic client authentication。现有 Connections/state/Credentials 单调版本与 fail-closed 边界继续复用；官方文档未证实的 PKCE/Scope 不能照抄 Google/GitHub。参考 [Authorization](https://developers.notion.com/guides/get-started/authorization)、[Revoke](https://developers.notion.com/reference/revoke-token)。
- 授权 workspace 与可访问 page/data source 是不同边界；OAuth 成功不证明全部资源或全部 Capability 可用。第一版只 READ_PAGE / READ_DATA_SOURCE / CREATE_PAGE / UPDATE_PAGE，采用 [Data Source](https://developers.notion.com/reference/retrieve-a-data-source) 而不是旧数据库对象假设。
- Page 属性与 block 正文不是同一接口/能力。第一版读取和写入有界结构化属性；不将属性读取宣称完整正文读取。写后必须用 page ID 再读取、比对 parent/批准 properties，并生成既有 VerificationEvidence；[Update page](https://developers.notion.com/reference/patch-page) 的字段契约为准。
- [Request limits](https://developers.notion.com/reference/request-limits) 映射 429/Retry-After；本地预算不是官方 quota。禁止 adapter 隐式 write retry；可能已产生副作用但没有 page ID 时保留 OUTCOME_UNKNOWN，只走既有 Reconciliation 的只读/用户确认路径。

## 待实施

配置契约与 HTTPS callback → HTTP/OAuth client → 四项 Manifest/Evidence/Policy 与权限/Health → 有界 Page/DataSource schema → 复用 Generic Observation/Candidate/Truth → 现有 ActionIntent/Resolver/Risk/Approval/Execution/Verification → 实际 HTTP/TCP/MySQL 隔离验收 → 真实 workspace 验收。新增定义使用新 revision，不能改已发布 skeleton；不创建 Notion auth/truth/execution 专属表或 Engine。

## 058151e 后续实现准备

2026-09-14 用户修订：先收口该提交完整远端门禁，再立即进入 9E；9D 真实账号验收独立保留。Scenario 测试契约修复 `553f2fc` 的本地 Full API 682/4、Monorepo 16/16 与远端 RC 已通过，Android 门禁仍待完成；本节只是接口核对，不宣称 Adapter 已实现。

- [Token introspection](https://developers.notion.com/reference/introspect-token) 返回实际 active/scope/iat。Scope 字符串必须来自服务器 token introspection；文档只给抽象 scope 字符串，不能从客户端请求或“OAuth 成功”推断所有 Capability。无法识别或缺失的 scope 按缺权限处理。
- [官方 Content capability 映射](https://developers.notion.com/guides/data-apis/working-with-markdown-content#access-control-summary) 提供 `read_content / insert_content / update_content` 名称。四项实现只匹配已核对的精确权限名称，未知权限不扩展授权。写能力同时要求 read content 才能完成 read-back；这不是 Notion 官方写端点的最低权限，而是本产品写后验证的安全要求。
- [Create page](https://developers.notion.com/reference/post-page) 页面内容通过官方 `.md` 文档只读核对成功：Page parent 仅能写 title 属性；DataSource parent 的 property keys/types 必须匹配实际 schema。第一版拒绝 workspace-level parent、template、trash、parent move、任意 block/markdown、批量写等未纳入批准载荷的扩张。
- 公共 OAuth 不复制 Google/GitHub 的 PKCE 请求字段；现有 state/CAS store 原样复用。Refresh 返回新 access/refresh pair，必须验证 bot/workspace/owner 稳定性并单调旋转；缺少官方 expiry 不伪造 expiresAt。
- 写后返回 page ID 再 GET 并核对 parent、批准 properties 与目标身份。创建请求可能已产生副作用但无 ID 时，不能用“查询未找到”推断未执行，不能 POST 重试；只读定位无法唯一证明时继续 OUTCOME_UNKNOWN 并走用户确认。
