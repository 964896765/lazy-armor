# Mobile V5 基线与交付核对（2026-09-22）

本文件对照《懒人装甲_前后端统一开发与Mobile前端设计总规划_V5.0》，以仓库代码、`git ls-remote origin refs/heads/main` 和本地测试为准。文档中的建议 API/DTO 属于目标设计；没有对应服务端实现和契约测试前，不作为已交付接口。

## 代码基线与技术路线

| 项目 | 已核实状态 | 交付口径 |
| --- | --- | --- |
| GitHub main | `e8646a256a0ce83868be4565f135ca35cbab450e` | 与 V5 文档一致；PR #2 是已合并基础，不回退。 |
| 当前本地开发分支 | `fix/rc-full-gate-real-db-concurrency@e1e6954f80d6a134adb8719e044595d3e1e4234d` | 包含 main 后续开发；不是 GitHub main。工作区另有未提交改动，不能称为 clean/RC。 |
| Mobile | Expo 57.0.18、React Native 0.86.3、Expo Router 57.0.17、React Query 5.102.8、Zustand 5.0.15 | 与 V5 表格相符；Expo Router 的 Tabs 仅作为路由容器，产品导航使用左侧 Rail/抽屉。 |
| API | NestJS 11.1.18、Drizzle 0.45.2、MySQL、Redis/BullMQ | 与 V5 路线相符；必须继续复用现有 Plan/Truth/Risk/Approval/Execution/Verification 权威链。 |
| Monorepo | pnpm 9.12.0、Turborepo 2.5.6、TypeScript 5.9.2 | 与 V5 表格相符。 |

## 页面与数据承载

| V5 范围 | 当前落点 | 仍需验收或补齐 |
| --- | --- | --- |
| Auth / Onboarding | `apps/mobile/app/auth/*`、`onboarding.tsx` | Login/Register/Forgot/Reset 有路由；**Verify Email 暂无独立页面与对应后端流程**，不能标 P0 全绿。 |
| App Shell / Space / Domain / Scenario | `(tabs)/_layout.tsx`、Space drawer、`(tabs)/domains.tsx`、`domains/[domain].tsx`、`domains/[domain]/[scenario].tsx` | 四个 canonical Space Group、19 Domain、96 Scenario 复用共享目录；场景详情读 readiness/runtime evidence、Truth、后端隔离的关联 Plan、执行和模板。需要真机可用性检查和契约快照。 |
| Today / Plans / Records | `(tabs)/index.tsx`、`(tabs)/plans.tsx`、`plans/[id].tsx`、`(tabs)/records.tsx`、`executions/[id].tsx` | 都读取现有 API；处理中/结果未知不能算成功。需要真实用户数据核对卡片优先级、离线/授权失效和 execution evidence。 |
| Connection / Capability | `(tabs)/connections.tsx`、`connections/[id].tsx`、`connections/[id]/capabilities/[key].tsx` | 必须继续分别展示官方可用性、实现、用户授权、运行健康；安装 App 或连接成功不能推断能力可用。真机权限/撤权证据仍为独立门禁。 |
| Truth / Evidence | `truth-store.tsx`、`truth/[id].tsx`、`privacy-center/data.tsx` | 列表只读取 verified Truth；详情显示摘要、来源/版本/证据哈希。独立 Evidence Detail 和完整 freshness/conflict consumer projection 尚未齐备。 |
| Strategy / Lifecycle | `strategies/*`、`plans/[id]/lifecycle.tsx`、`executions/[id]/lifecycle.tsx` | 8 Strategy 和 15 步共用后端定义/记录；未到达步骤必须显示未到达，不能用静态完成态。 |
| Approval / Risk / Reconciliation / Security | `approvals/*`、`reconciliation/*`、`security-center.tsx`、`security-activity.tsx` | 已有入口与明细；真实 OUTCOME_UNKNOWN 不可出现普通重试副作用按钮。需真实断网/写后回查证据。 |
| Device / DeviceTask | `devices.tsx`、`connections/trusted-devices.tsx`、`connections/device-tasks.tsx` | 列表/任务页存在；V5 的独立 Device Detail/DeviceTask Detail 与真机长时间稳定性验收未完整收口。 |
| Privacy / Agent / MCP | `privacy-center*`、`data-management.tsx`、`(tabs)/create.tsx` | 隐私数据清单与 AI Draft 入口存在；账户删除仍明确关闭；MCP 前端为后续扩展，不能作为已交付真实 Provider 能力。 |

## API Contract 统一决策

1. 当前服务端实际前缀是 `/api`，Mobile `api()` 在路径前添加此前缀；V5 文档的 `/v1`、统一 `ApiEnvelope<T>`、`projectionVersion` 是**待迁移目标**。不能只在 Mobile 改路径或包一层假 Envelope。迁移应由 API 提供兼容路由/投影和 contract tests，再逐页切换。
2. 当前页面可以组合已有只读 API，但复合状态的最终判定必须在后端 Consumer Projection：Readiness、Truth freshness/reality、Connection grant/health、Execution verification/reconciliation。客户端只格式化和导航。
3. `Scenario → Plan` 的只读关系已增加 `/api/strategy-runtime/bindings?scenarioKey=...`，仅返回当前用户当前/启用 PlanVersion 的绑定；该接口需要随本次 Mobile 改动一起合入，并保持用户隔离契约测试。
4. 对没有服务端证据的“已健康、已授权、已完成、已验证”一律显示未核实/不可用/加载失败，不使用 fixture 补绿。

## 本次验证与交付门禁

- Mobile typecheck、179 项 Mobile test、Android JS bundle export、API typecheck、Strategy Runtime MySQL integration（6 项）已通过。
- 依赖链接已用锁文件和 isolated linker 重新安装修复；未修改锁文件。最新 `pnpm test` Full Gate 已通过：16/16 Turbo tasks；API 103 个测试文件、810 项通过，Mobile 179 项通过，相关 build 通过。API 另有 4 个文件/51 项因环境或真实账号门禁跳过，不能据此宣称这些真实链路已验证。
- `p5-truth-store` 已改为验证当前唯一链 `Notification → Observation → Candidate → Truth`：覆盖 ingestion/confirmation 失败、无 Candidate、重复确认、半成品 Truth 和非法候选的 fail-closed，7/7 通过。
- 当前 MySQL 是本机 8.4.11（3307），Docker 只运行 Redis。MySQL 容器 stop/start 故障注入测试会按环境跳过，不能把跳过描述为 RC 故障注入已验证；该项须在隔离的 MySQL 8.4 容器门禁中补跑，且不得为了测试停止用户本机数据库。
- 工作区还存在本次 V5 页面之外的 Android native 文件删除及其他未提交改动。合并/发版前须明确归属并重新跑 Android APK/AAB、真机和 RC Full Gate；不得在不知归属时清理这些文件。
- 真实设备、真实 Provider 账号、权限撤销、写后断网、OUTCOME_UNKNOWN 等不能由 Bundle/单元测试代替。只有实际证据通过的链路可标 REAL VERIFIED。

下一阶段按交付风险顺序：先收口依赖与工作区、跑完整门禁；再补 Consumer Projection 与缺失 P0/P1 契约；随后做真机/真实账号 Beta 验收；最后才申请 RC/发布。不要另建 Engine，也不要为了页面覆盖数伪造数据。
