# 懒人装甲连续开发状态

更新时间：2026-09-04

## 当前阶段

`Current Stage = Release Candidate`

> **架构约束优先级：** `docs/TASK_BOOK.md` 是移动端互联和生产数据真实性的强制任务书。任何具体 Provider/App 只能作为 Connector/Adapter/Catalog 的可选增强，不能成为核心业务前提；任何生产 UI 无真实来源数据时必须显示空态，Fixture/Mock 仅允许测试或显式 Demo 环境。

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
- DeviceAppConnection 已依照 `docs/TASK_BOOK.md` 从过渡期白名单重构为真实发现的 Generic App Connection：前向 `0029_device_app_connections` 只建立初始记录，`0031_generic_device_app_connections` 追加连接类型、真实显示名称/版本/可启动状态、发现指纹和可选 Adapter 键。用户隔离、添加/启用/停用与 append-only 审计均保留；Catalog 仅记录可选 Enhanced Adapter，绝不决定任意真实可启动 App 的创建资格。
- Android `LazyArmorDeviceBridge` 现在仅按启动器 Intent 向 PackageManager 读取当前设备真实可启动应用，并返回名称、版本、启动状态、尺寸受限图标与发现指纹；添加连接页面不再预置品牌或安装状态，Web、iOS、Expo Go 与发现失败时显示诚实空态。Manifest 不使用 `QUERY_ALL_PACKAGES`，也不维护具体品牌包名 `queries`。
- 通知来源与可信设备 Beta Foundation 已升级为通用模型：`0030_mobile_notification_receipts` 保存用户授权连接的包名、时间、事件/内容指纹及端侧候选摘要，永不保存标题或正文；`0032_trusted_devices`、`0033_trusted_device_challenge_public_key` 建立 Android Keystore P-256 一次性挑战签名、当前账号绑定、激活/撤销与审计链。创建连接、启用通知与收据入站均需同一未撤销的 `key_proven` 设备；撤销时服务端关闭所有绑定连接，端侧停止该连接的通知来源。
- Generic Parser / Classifier / Normalizer 已在 Android 端侧以 `generic-notification-v1` 落地：无包名/Provider 分支，仅在进程内将原文处理为 `unknown`、`billing_transaction_candidate` 或 `account_notification_candidate`，并以资源键、0–100 置信度、可持久化金额（如有）、货币和原文哈希输出。服务端再次校验字段组合、时间窗、授权、信任、限流和幂等；候选状态恒为 `received_unclassified`，不会自动写成任何领域事实或外部动作。
- Brand-neutral Truth Store 已通过 `0034_truth_store` 落地：用户在通知来源页显式确认语义一致的账单候选后，才写入 `truth_records` 与不可变 `truth_record_versions`（`resourceKey`、验证方法、来源收据、值/证据哈希、当前版本）。未知或不完整候选、用户拒绝与设备失活均不能生成事实。`TruthStoreService` 已被 `SourceResolver` 消费，内部资源 `mobile.billing.transaction` 仅向 Plan Engine 提供已验证记录与真实金额汇总，不包含包名、Provider、适配器键或通知原文。
- 移动端真实状态闭环已补齐：可信设备页显示 API 返回的密钥证明摘要并支持用户撤销；通知来源页显示真实待确认候选并允许“确认事实/拒绝”；已验证事实页仅查询 `/truth-records`。连接 Rail 仍只读取用户真实已启用连接，不使用 Fixture 或生产 Mock。真机流程与隐私留存模板见 `docs/ANDROID_TRUSTED_DEVICE_ACCEPTANCE.md`。
- 本轮定向验证通过：可信设备、Generic Connection、通用通知、Truth Store 与 Plan Source Resolver 5 files / 15 tests；Mobile 12 files / 90 tests；API、Database、Mobile 类型检查通过。此前通过的生产数据真实性、迁移安全与仓库卫生门槛保持适用；新增迁移 `0032`–`0034` 均为前向追加、非 destructive。

## 当前 Workstream

`Release Candidate W1 / RC-7 Observability` 继续推进“移动端与全域互联”Beta Foundation：代码已覆盖“可信设备 → 通用端侧候选 → 用户确认验证 → Truth Store → Plan Source Resolver → 通知/事实界面”。下一项是 Android 真机构建、双账号真机验收、MySQL 前向迁移和 GitHub/远程可观测性运行证据；在证据前，不得将该链路标记为生产完成。

## Deferred Gate

- 真实支付、转账、高风险下单与账户权限修改仍为 `DISABLED / DEFERRED`。
- 真实 Payment Provider、正式 Android Signing、Admin Enterprise Identity 仍为 `DEFERRED / PRODUCTION GATE`。
- Android 正式 Beta 仍需正式 release keystore 与真机 SecureStore 验证。
- 尚未获得 Production Evidence 的 Provider 继续 `DEFERRED`。
- 密码重置投递网关尚未提供 staging/production 凭据与实投证据；代码已失败关闭，保持 `DEFERRED_GATE`，不得将其标记为真实生产投递已完成。
- 本轮执行器未安装 Docker，无法在该执行器重启 MySQL/Redis 后完成 API 全量集成测试与 backup/restore gate；全量类型检查、构建、迁移安全、仓库卫生与生产依赖审计均已通过，集成验证需在具备 Docker 的 CI 或本地环境继续执行。
- 新增的 Fast Gate、RC Full Gate 与 Windows Android artifact workflow 尚未在 GitHub Actions 实跑；在获得 main/手动运行记录前，不得将 RC-4 记为 CI evidence complete。
- `0029_device_app_connections` 至 `0034_truth_store` 仅作为前向迁移和 Schema/API 代码通过静态、策略测试与迁移安全检查；尚未在 MySQL 中实际执行，仍需 Docker CI 或本地完整集成验证。
- Android Bridge 在此执行器中无法完成 App Kotlin 编译：Gradle Wrapper 与 Expo/React Native Gradle 插件配置已启动，但环境没有 Android SDK（未设置有效 `ANDROID_HOME`/`sdk.dir`），在 `:app` 配置阶段失败，尚未进入 Bridge 源码编译。不得将真实发现、图标转换、通知监听或 Android 构建标为已通过。
- Generic App Connection 的真实启动器发现、图标渲染、可信设备 Keystore 挑战签名、添加后 Rail 回流、停用/设备撤销、通用通知系统授权、按 App 授权/撤销、端侧候选队列、后台回调与两账号隔离，均需按 `docs/ANDROID_TRUSTED_DEVICE_ACCEPTANCE.md` 在包含原生模块的 Android Debug/候选发布包中验收。Web、iOS 或 Expo Go 的“无法读取设备应用/通知来源”是设计内安全降级，不是设备状态。
- 通用端侧 Parser / Classifier / Normalizer、可信设备挑战证明、用户确认验证、Truth Store 与 `mobile.billing.transaction` Plan Source Resolver 已实现并通过策略测试，但 Android Kotlin 代码尚无候选包/真机编译运行证据，MySQL Schema 尚未实迁，且该首版确定性 Parser 只产生候选而非自动真相。未经用户确认，所有通知线索仍必须保持 `received_unclassified`；不得显示为真实账单、订单、车辆、家庭或设备事实。
- 本轮对 npm 生产依赖审计的复跑受 npm audit API `ERR_SOCKET_TIMEOUT` 影响而中止；先前已记录的无高危审计结果不能替代下一次 CI 的真实审计运行。
- 过渡期的 Catalog 创建白名单与单一 Provider 通知逻辑已从核心路径移除，并由 `docs/TASK_BOOK.md`、`docs/ANDROID_SUPPORTED_APP_CATALOG.md` 与 `pnpm data:truth` 约束持续回归；真机、可信设备与 GitHub CI 证据缺失时，Generic Connection/通知来源不得被宣称为生产完成。
