# Batch 9B — Gmail Provider 实现与验收边界

基线 main@87da4ed；依照 2026-09-13 用户执行修订。公共 Runtime、Execution、Strategy、Approval Snapshot、Truth Version 与 Reconciliation 均复用，不增加 Email Engine。

## 配置与认证

三项环境变量必须同时注入：`GMAIL_OAUTH_CLIENT_ID`、`GMAIL_OAUTH_CLIENT_SECRET`、`GMAIL_OAUTH_REDIRECT_URI`。全部缺失时 Provider DISABLED，授权入口 503，不出站。部分配置、占位符、非 Google client ID、非 HTTPS 或非精确 backend callback URI 在 bootstrap 拒绝。

Google 回调：`GET /api/providers/google/oauth/gmail/callback`。授权开始：鉴权 `POST /api/providers/google/gmail/authorize`。精确 HTTPS redirect、随机 state、S256 PKCE、10 分钟时限。回调不依赖 Google 浏览器携带本应用 JWT；以不可猜测 state 找到原授权发起者。现有 OAuth state 在 token I/O 前 CAS 一次性 claim，失败也不能交换第二次，清除已消费 verifier，用户需要重新授权。`0046_google_oauth_completion` 只扩展原表的两个 nullable 状态字段。

HTTPS-terminating ingress 需配置 `TRUSTED_PROXY_CIDRS` 为明确 IP/非零 CIDR；默认不信任转发头。仅伪造 `X-Forwarded-Proto` 不会开启回调。回调响应 no-store，不返回 access/refresh token。Google Transport 固定官方 HTTPS origins；隔离测试通过 DI 接本地 TCP，不提供生产 URL override。

认证复用 `GoogleOAuthClient` 与既有 CredentialProvider：authorization code → token、offline refresh、revoke，使用已有加密存储/单调 credential version。刷新写回同时验证本地 connection/ref 未撤销、version 未变化；撤权先关闭本地 Grant/Health，Google revoke 失败也不能重新开放操作。

## Capability 与四维 Reality

Manifest revision 2 包含五项能力：READ_EMAIL_METADATA、READ_EMAIL_BODY、READ_EMAIL_LABELS、CREATE_EMAIL_DRAFT、SEND_EMAIL。官方文档 review VERIFIED 与实现 BETA 不能代表真实测试账户验收。Grant 由 token 实际 Scope 投影，Health 由真实 adapter profile HTTP 响应生成并具有 TTL。配置完整仅表示可启动 OAuth，不表示已授权、已健康或已完成。

读取采用 gmail.readonly；草稿 compose + readonly，发送 send + readonly。写操作必须具备回读 Scope，拒绝不可验证写入。用户手动授权开关不能补造 Google 未授予的 Scope。现有历史 READ_EMAIL/CREATE_DRAFT 概念不删表、不覆写历史 PlanVersion；真实 adapter 不宣称实现旧能力。

READ_METADATA 不生成正文 Fact。Generic parser 新增 EmailMessage 元数据/正文/标签三种 schema，subject/resource identity 包含 connectionId，防止多个邮箱同 messageId 冲突。Observation identity 包含 payloadHash，Gmail 可变状态更新不会复用旧 evidence identity。认证读取经过现有 Permissions/RateLimit/Circuit/Usage，汇入 SourceObservation → Candidate → immutable Truth/Provenance → 既有 Strategy Runtime。

## 写入与回查

邮件内容来自不可变批准动作的 `triggerPayload.email = { from, to, subject, body }`；from 必须匹配授权账号，不允许重新连接后更换发件身份。SEND_EMAIL 绑定既有 publish action；草稿绑定既有 create_draft action，不扩张 Action Type 或 Runner。Risk floor 草稿 R2、发送 R3。没有 ActionIntent/Approval/Existing Operation 绑定的直接 provider.execute 请求会在出站前拒绝。POST 成功但返回无效消息 ID 按 AFTER_DISPATCH 处理，汇入未知结果回查，不能声称没有副作用。

只允许 plain text、最多 20 个收件人、subject 512 bytes、body 128 KiB；禁止 header injection，不下载附件。POST 成功后按 messageId/draftId GET 回读并比对批准的 subject/to/from/body/Message-ID 和 SENT/DRAFT 标签，Evidence 使用既有 VerificationPolicyRegistry/VM。

稳定 RFC Message-ID 用于只读搜索，**不是 Google 提供的幂等保证**。Manifest 明确 supportsIdempotencyKey=false、retrySafety=unsafe、supportsOperationLookup=true。若 POST 可能产生副作用而网络断开，或写后回读失败，既有 Outbox 保持 OUTCOME_UNKNOWN，不重发。Reconciliation 仅 messages.list + messages.get；尚未可见、多条匹配、内容不一致都不能标成功。

每次调用采用保守加权预算：metadata/body 1005、labels 20、draft 30、send/read-back 120 units。读取批量最大 50，预算包含全部 GET。短读取重试由公共 bridge 控制，写入只提交一次，429/撤权/Scope/超时错误映射为已有稳定错误契约。

## 官方依据与真实验收

- [Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [PKCE contract](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Gmail send](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Message get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)
- [Quota method weights](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Error handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors)

证据 digest 是明确的 normalized review record，不冒充下载网页的 hash。真实账户验收仍须 OAuth/refresh/Scope/邮件读取/草稿/测试发送/revoke/429/断网/unknown/write-readback 全部通过后关闭 9B。当前隔离 HTTP/DB 测试不能替代此验收。
