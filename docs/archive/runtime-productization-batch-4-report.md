# Batch 4 — Android Foreground Acquisition 开发报告

状态：已完成  
基线：`main@90766dc`  
日期：2026-09-09

## 交付结果

- 建立 `AppReadSession` 与 `AppReadSessionEvent` 共享合约和确定性状态机，覆盖等待前台、读取中、主动停止、离开前台、超时与错误终态。
- 新增受可信设备签名保护的会话创建、查询、心跳、事件写入和停止 API；一个可信设备同一时刻最多存在一个活动会话。
- Android 新增前台采集服务、目标包名守卫、心跳与本地会话存储，并将通知监听和主动分享收件箱接入同一会话边界。
- 通知与分享只产生 `SourceObservation` 和待确认 `CandidateFact`，继续通过 Batch 3 Generic Reality Pipeline 汇入现有 Truth Version / Audit；不会绕过 Plan、Risk、Approval 或 Execution。
- Mobile 新增会话状态页，展示实际会话、采集模式、剩余时间、安全边界和事件记录，支持同步、打开目标应用与主动停止；布局和视觉沿用当前产品设计系统，不复制参考图左侧导航。
- 本 Batch 未实现万能 Accessibility Agent、自动点击、MediaProjection 或 Vision 泛化。

## 数据库与迁移

- `0039_app_read_sessions.sql` 新增 `app_read_sessions` 与 `app_read_session_events`，保存会话边界、状态、时间窗和证据哈希。
- 活动设备键通过唯一约束保证并发创建时只有一个活动会话；事件键在会话内唯一，重复事件仅在证据完全一致时幂等。
- 外键名称使用 MySQL 兼容的短标识，开发库和测试库均已完成前向迁移。
- 迁移不含 `DROP` / `TRUNCATE`，未修改历史 PlanVersion、Execution、Approval、Outbox 或 Audit 不可变语义。

## 安全与隐私边界

- 会话仅允许已登记且未吊销的可信设备创建，所有写操作均要求短时设备签名；跨用户读取返回不可见。
- Runtime 只在目标应用包名精确匹配、前台心跳新鲜、读取模式已授权且会话未过期时接收事件；包名变化、权限缺失、心跳超时或证据冲突全部 fail-closed。
- Android 本地队列不持久化通知或分享原文，只保存不可逆摘要和最小化规范化候选；原始内容不进入设备持久层。
- 默认会话 5 分钟，单次最长 15 分钟；读取过程需要持续前台心跳，不提供后台无限采集能力。
- Candidate 不是 Truth，采集成功也不代表允许执行真实动作；高风险动作继续经过现有 Risk / Approval 边界。

## 并发与验证

- Batch 4 API / DB / Contract / Concurrency 专项覆盖：无签名拒绝、可信设备登记、并发会话唯一、跨用户隔离、心跳状态迁移、并发事件幂等、Candidate 非 Truth、前台包名变化 fail-closed。
- Migration safety、开发数据库迁移与测试数据库迁移：通过。
- Android `compileDebugKotlin`：通过。
- Plan Schema、Mobile TypeScript 与 Mobile 单元测试：通过。
- Monorepo typecheck、Full API Test、Monorepo Test / Build：通过。

## 架构结论

本 Batch 将 Android 前台现实采集实现为 Generic Reality Pipeline 的受限输入 Adapter，而不是第二套执行引擎。现实输入最终仍沿用 `Source → Trigger → Condition → Action → Risk → Approval → Execution → Result → Fallback → Audit` 唯一主链；Execution Engine 和历史不可变记录均未重写。
