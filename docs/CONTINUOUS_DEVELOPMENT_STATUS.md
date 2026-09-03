# 懒人装甲连续开发状态

更新时间：2026-09-04

## 当前阶段

`Current Stage = Release Candidate`

P0～P5 均达到 `DEVELOPMENT COMPLETE`，Final Integrated Audit 结论为 `PASS_WITH_DEFERRED_GATES`。不再新增普通业务功能，仅允许 Beta installation / 真机验证 / 正式 signing / staging evidence / Provider production enablement / crash-bug 修复 / release checklist。禁止自行创建 P6。

## 已完成

- P4 focused regression：P4 五组测试及 P0 安全聚焦测试全部通过。
- P5 专项测试：8 files / 48 tests 通过（Membership / Entitlement / Usage / Subscription Sandbox / Template Lifecycle / Connector Contract / Cost / Scale）。
- P5 Final Closure 补强：Checkout 并发幂等、Cancellation 幂等、Webhook out-of-order 时序保护、Membership downgrade 边界、Usage exactly-once、Cost 并发预算守卫、Connector SDK 兼容契约、真进程多 Worker Scale Gate。
- Mobile 核心测试：认证闭环扩展后 11 files / 86 tests 通过；包括安全存储恢复、全局认证跳转、注册首登引导与既有移动端回归。
- Monorepo typecheck：8 packages 通过。
- Database backup/restore gate 通过（P0～P5 数据 + `orphanRows = 0`）。
- Admin 已从静态 Shell 收口为只读 Operations Dashboard，接入 7 个既有诊断接口。
- Android development verification AAB 构建通过；该包使用开发验证签名，不等于生产 Beta Gate。
- RC-2 Mobile Auth 已收口：根 `AuthGate` 已接入；注册、登录、忘记密码、重置密码与首登引导路由完整；已登录用户无法回退到认证/引导页，未登录用户无法访问主应用。
- 密码重置采用受控投递边界：仅在配置 HTTPS 投递网关与非占位凭据后发送应用深链；无网关或投递失败时统一响应且不写入可用重置令牌。staging/production 启动会校验该配置，相关配置测试 13 项、投递服务测试 3 项均通过。
- RC-2 编译验证：`@lazy-armor/config`、`@lazy-armor/api`、`@lazy-armor/mobile` 类型检查通过；移动端 Web 导出构建通过。
- RC-3 Process Isolation 已收口：staging/production 必须显式声明 `APP_ROLE`；默认启动入口固定为 API；执行队列补偿器仅在 execution-worker 角色运行；API、execution-worker、outbox-worker 入口不会覆盖部署声明的角色。配置门槛测试 15 项、角色/入口/重置投递测试 9 项均通过。

## 当前 Workstream

`Release Candidate W1 / RC-4 Full CI`（RC-2 Mobile Auth、RC-3 Process Isolation 已收口）

## Deferred Gate

- 真实支付、转账、高风险下单与账户权限修改仍为 `DISABLED / DEFERRED`。
- 真实 Payment Provider、正式 Android Signing、Admin Enterprise Identity 仍为 `DEFERRED / PRODUCTION GATE`。
- Android 正式 Beta 仍需正式 release keystore 与真机 SecureStore 验证。
- 尚未获得 Production Evidence 的 Provider 继续 `DEFERRED`。
- 密码重置投递网关尚未提供 staging/production 凭据与实投证据；代码已失败关闭，保持 `DEFERRED_GATE`，不得将其标记为真实生产投递已完成。
- 本轮执行器未安装 Docker，无法在该执行器重启 MySQL/Redis 后完成 API 全量集成测试与 backup/restore gate；全量类型检查和构建已通过，集成验证需在具备 Docker 的 CI 或本地环境继续执行。
