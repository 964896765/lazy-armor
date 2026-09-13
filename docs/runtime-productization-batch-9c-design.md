# Batch 9C — Google Calendar 接入设计与验收边界

日期：2026-09-13。状态：官方接口核对与接入设计开始；**不是代码完成报告，不是实际账号验收证据**。9B 真实账号验收仍独立待办，缺 Secret 不阻止本文件的非账号设计工作。

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
