# Batch 9C — Google Calendar 接入设计与验收边界

日期：2026-09-13。状态：下述非 Secret 接入已实现，专项隔离回归通过；实现与门禁证据见 [9C report](./runtime-productization-batch-9c-report.md)。**不是实际账号验收证据，9B/9C 真实账号验收仍独立待办**。

## 不变的公共链

复用 GoogleOAuthClient 的 state、PKCE、exchange、refresh、revoke，既有 OAuth state/CredentialProvider/单调 CredentialVersion，不建立 Calendar 专用认证或 Engine。Calendar 授权必须声明自己的 Scope；不得从 Gmail 的已连接状态推断 Calendar Grant。具体 Calendar 回调/配置契约在实现中显式定义并验证，不替换已发布 Gmail Manifest revision 2、Evidence revision 1 或 RuntimePolicy revision 1。

资源复用已存在的 CalendarEvent；新增事实 schema/正常化适配只扩展 Generic Pipeline。写入仍经过 ActionIntent → Risk → Immutable Approval → Resolver → Existing Execution/Outbox → Verification/Reconciliation。当前历史 GoogleCalendarConnector 属于既有隔离 fixture 路径，不能作为真实 OAuth、真实 API 或 Journey 的完成证据；切换真实 handler 时保留历史能力目录标识与 PlanVersion/Audit，只退休未实现的当前 handler。

## 第一版边界

- READ_CALENDAR_EVENT：按具体 calendarId/eventId GET，或有上限的事件列表；只读最窄 events Scope。实际 Token Scope、目标资源权限、Health TTL 与限流共同决定可用性。
- CREATE_CALENDAR_EVENT：批准快照固定账号身份、calendarId、标题、起止时间/时区、参与人和通知策略。创建后以实际返回 eventId GET；比对标题、时间和全部批准参与人后生成 VerificationEvidence。
- UPDATE_CALENDAR_EVENT：批准内容另外固定 eventId 和读取到的 ETag；条件写使用 If-Match，资源变化不能悄悄覆盖另一用户的更新。PATCH 数组替换语义必须纳入合同和测试，不做未经批准的参与人扩张。

第一版不增加删除、ACL、附件下载、会议录制、万能会议创建等能力。需要更广 Scope 的能力没有获得实际 Grant 时 fail-closed。日历邀请和通知可能产生外部副作用，不能把创建日程当成纯本地写入；Risk Floor 保持不低于现有 Calendar 写动作的 R3。

## 未知结果处理

创建/更新仅一次出站写入；响应丢失、成功响应缺 ID、写后读取失败均不能标成功或直接重复写。创建的稳定客户端 eventId 只作相关性/查重辅助手段，不未经核实宣称 exactly-once。409 冲突必须读取并验证是否为同一批准操作；404、参与人被省略、内容不一致、ETag 冲突不能伪造 SUCCEEDED。未知结果进入既有 Reconciliation，只有读取与比对，禁止借回查重做写动作。

## 交付与验收清单

实现期同步提供 Manifest/Evidence/Policy、Schema、必要的增量 Migration 或明确 N/A、Service/API、Unit、DB、Concurrency、Migration/Contract、Full API、Monorepo、Typecheck。公共 Runtime 合约不重复造另一套，只测试 Calendar 的 OAuth Scope、资源权限、429、撤权、ETag、写后回读、断网不重发等差异。

第一条跨 Provider 验收为 Gmail 会议信息 → authenticated SourceObservation → Candidate/Truth → 用户确认 → Calendar Event → eventId Read-back → VerificationEvidence → Record。隔离 TCP/DB Journey 与真实 Google 测试账号 Journey 分开报告；后者缺 Secret/真实账号时不能关闭 9C 或 9F。

## 已核对的官方来源

- [Calendar authorization scopes](https://developers.google.com/workspace/calendar/api/auth)
- [Events insert：calendarId、参与人与通知策略](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Events get：按 eventId 回读](https://developers.google.com/workspace/calendar/api/v3/reference/events/get)
- [Events patch：部分更新与数组替换](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)
- [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [Conditional resource versions / ETags](https://developers.google.com/workspace/calendar/api/guides/version-resources)
- [Errors](https://developers.google.com/workspace/calendar/api/guides/errors)
- [Quota](https://developers.google.com/workspace/calendar/api/guides/quota)

## 本次实现落地的精确契约

Calendar 不增加另一套 Client ID/Secret，复用 GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET；新增 GOOGLE_CALENDAR_OAUTH_REDIRECT_URI，必须为 HTTPS 且精确路径 `/api/providers/google/oauth/calendar/callback`。该 URI 缺失时 Calendar 独立禁用；显式设置而共享配置不完整时 bootstrap fail-closed。GoogleOAuthSessions 只适配 HTTP callback，全部状态 CAS、凭证 version、refresh/revoke 仍属于已有 Connections/Credentials。

第一版只操作实际 `/calendars/primary` 返回的本人主日历，Token 另需 calendar.calendars.readonly 以核对实际账号身份；不推断 arbitrary calendarId 访问权限。读 Scope 为 calendar.events.readonly，写 Scope 为 calendar.events。批准上下文是 `triggerPayload.calendarEvent`：calendarId、title、带 offset 的起止 dateTime 与 IANA timeZone、attendees（最多 20）、明确 sendUpdates；更新另有 eventId 和带引号的 ETag。未知字段、跨账号、无 Scope、无 ETag 或结束不晚于开始全部写前拒绝。

写能力通过既有 publish 外部动作承载（config.visibility=private），Capability 为 CREATE_CALENDAR_EVENT / UPDATE_CALENDAR_EVENT。publish 是已有通用外部动作，不是内容平台专属 Engine；审批固定完整 Calendar 上下文，Risk Floor R3，Outbox 仍从不可变批准上下文重建动作。没有直接 POST/PATCH Calendar 的 consumer API。

Generic CalendarEvent 新增 calendar_event.schedule Fact Schema、Parser/Normalizer 和 300 秒 Freshness，语义标识包含 connectionId/calendarId/eventId。不建立 Calendar 认证表、事实表或引擎。DDL migration N/A：使用既有 47 个迁移和现有 Registry/Observation/Truth/Verification 表，通过 additive catalog revision 发布，不修改已应用 SQL。

Google HTTP 只新增固定 `www.googleapis.com/calendar/v3/` origin/path 白名单，不允许任意 Google API 或替代生产 base URL。主日历身份 GET、条件 PATCH、写后 GET 均计入本地 request budget；预算不是 Google 官方项目 quota 的声明。只读有界重试，写仅一次。任何 POST/PATCH 后的 GET 失败（包括 403）统一 AFTER_DISPATCH/OUTCOME_UNKNOWN；GET 无副作用不能证明先前写无副作用。同一安全修正同步用于 Gmail，并增加回归，不改其已发布 Manifest/Evidence/Policy。

当前没有真实账号验收、没有 Workspace 共享日历覆盖、没有 Calendar webhook；列表最多 50 项且须显式 pageToken 翻页，不把单页读取宣称为完整同步。
