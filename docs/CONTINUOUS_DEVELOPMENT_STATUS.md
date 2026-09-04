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
- RC-4 Full CI 已收口：工作流拆分为 PR Fast Gate 与仅 main/手动触发的 RC Full Gate；完整门覆盖全量 test、backup/restore、build，Windows 验证任务产出调试签名 Android AAB artifact（非 production signing）。
- RC-5 Migration Safety 已收口：迁移检查同时校验序列/journal、destructive SQL、历史迁移不可变哈希；新的 destructive migration 必须提供 staging/production、非本地数据库、HEAD commit、backup/restore artifact 与精确 migration hash 的发布证据，否则失败关闭。
- RC-6 Repo / Supply Chain 已收口：新增仓库卫生与生产依赖审计命令；Android AAB/debug keystore 从 Git 索引移除并持续忽略；CI Action 锁定到不可变提交哈希。
- 移动端与全域互联设计的第一批兼容基础已落地（用户于 2026-09-04 明确授权，不创建 P6）：计划 Schema 新增 19 个规范领域，同时保留 `general`、`billing`、`shopping` 历史值。展示层通过别名映射将旧记录归入新目录，未修改任何既存 PlanVersion、Definition 或 DefinitionHash；旧“我的东西”仅在 UI 中显示为“我的物品”。
- 新移动端 Shell 已落地：固定 Connection Rail 提供消息、懒人装甲、懒人商城、真实已启用连接、添加连接和“我的”入口；新增 19 领域目录与单领域工作区（概览/计划/资料/动态），复用已有 `/plans` 与资料页数据，未伪造资源实时状态。
- 懒人商城空间已建立为第一方只读/准备入口：可从现有计划中显示待购买事项，明确真实商品、价格、支付、下单与物流仍需经过已连接服务、审批与结果验证；当前不创建订单、不支付、不自动下单。
- DeviceAppConnection Beta Foundation 已落地：新增前向 `0029_device_app_connections` 迁移、用户隔离 API、添加/启用/停用记录和 append-only 审计。首批 Android 目录是有限 allowlist（中国移动、微信、支付宝、淘宝、Gmail、Google 日历），不使用 `QUERY_ALL_PACKAGES`；当前已实现的唯一操作是用户主动打开已安装应用。
- Android `LazyArmorDeviceBridge` 已提供受限 PackageManager 安装检测与启动 Intent；移动端添加连接页会明确区分“已安装 / 未安装 / 无法检测”，仅在 Android 真机检测为已安装时允许添加。通知读取、页面跳转、支付协作、任意 Accessibility 点击与自动下单均未实现、未授权且保持失败关闭。操作说明见 `docs/ANDROID_SUPPORTED_APP_CATALOG.md`。
- 本轮静态与定向验证通过：Plan Schema 2 files / 7 tests，Shared 2 files / 6 tests，DeviceAppConnection API 策略 3 tests，Mobile 12 files / 89 tests，Monorepo typecheck 8/8 packages，Monorepo build 8/8 packages；迁移安全检查通过（30 files，新增迁移 destructive=0），仓库卫生检查通过（423 个已跟踪文件）。

## 当前 Workstream

`Release Candidate W1 / RC-7 Observability`（仍待远程可观测性与 GitHub 运行证据）并行推进“移动端与全域互联”Beta Foundation：下一项是 Android 真机构建/安装检测验证，之后才可评估中国移动通知读取 → 话费守护 → 消息的首条真实闭环。

## Deferred Gate

- 真实支付、转账、高风险下单与账户权限修改仍为 `DISABLED / DEFERRED`。
- 真实 Payment Provider、正式 Android Signing、Admin Enterprise Identity 仍为 `DEFERRED / PRODUCTION GATE`。
- Android 正式 Beta 仍需正式 release keystore 与真机 SecureStore 验证。
- 尚未获得 Production Evidence 的 Provider 继续 `DEFERRED`。
- 密码重置投递网关尚未提供 staging/production 凭据与实投证据；代码已失败关闭，保持 `DEFERRED_GATE`，不得将其标记为真实生产投递已完成。
- 本轮执行器未安装 Docker，无法在该执行器重启 MySQL/Redis 后完成 API 全量集成测试与 backup/restore gate；全量类型检查、构建、迁移安全、仓库卫生与生产依赖审计均已通过，集成验证需在具备 Docker 的 CI 或本地环境继续执行。
- 新增的 Fast Gate、RC Full Gate 与 Windows Android artifact workflow 尚未在 GitHub Actions 实跑；在获得 main/手动运行记录前，不得将 RC-4 记为 CI evidence complete。
- `0029_device_app_connections` 仅已作为前向迁移和 Schema/API 代码通过静态、策略测试与迁移安全检查；尚未在 MySQL 中实际执行，仍需 Docker CI 或本地完整集成验证。
- Android Bridge 在此执行器中无法完成 App Kotlin 编译：Gradle Wrapper 与 Expo/React Native Gradle 插件配置已启动，但环境没有 Android SDK（未设置有效 `ANDROID_HOME`/`sdk.dir`），在 `:app` 配置阶段失败，尚未进入 Bridge 源码编译。不得将其标为 Android 构建已通过。
- DeviceAppConnection 的真实安装检测、添加后 Rail 回流、停用后的撤销、跨账号隔离，均需在包含该原生模块的 Android Debug/候选发布包与两组测试账号上验收；Web、iOS 或 Expo Go 的“无法检测”是设计内安全降级，不是安装状态。
- 中国移动通知读取、账单解析/验证/去重、话费守护消息闭环仍未实现。后续必须先取得独立的系统通知访问授权，完成来源 allowlist、隐私最小化、Source Acquisition、验证、审计与撤销测试，禁止以通知读取或 Accessibility 泛化为任意 App 自动操作。
- 本轮对 npm 生产依赖审计的复跑受 npm audit API `ERR_SOCKET_TIMEOUT` 影响而中止；先前已记录的无高危审计结果不能替代下一次 CI 的真实审计运行。
