# 懒人装甲 Lazy Armor

懒人装甲是以 Goal 为入口、具备感知、理解、规划、执行和验证能力的个人生活操作系统。系统判断一次性任务、内部个人事项或长期目标，解析真实方法与资源，在授权范围内执行并核实结果。

当前统一主线：

```text
Goal → Context / Planner → Temporary / USER_EVENT / Persistent Plan
  → Skill / Resource Resolve → Shared Runtime → Verify / Truth → Result / Replan
```

移动端永久固定五个一级入口：日程、计划、会话、资源、服务。个人中心由头像进入。当前代码已推进到 V91–V94 的目标生成、受控学习、组合报告与消费者 PC 工作台；完整 Beta 与发布验收仍未关闭。

## 当前文档

- [Personal Life OS 总方案 V2](./docs/current/PERSONAL_LIFE_OS_MASTER_PLAN_V2.md)
- [全面优化执行方案 V1.1](./docs/current/PROJECT_OPTIMIZATION_PLAN_V1_1.md)
- [S0 第二批：Admin 鉴权验收与当前分析](./docs/current/OPTIMIZATION_S0_BATCH_02_ADMIN_AUTH.md)
- [S0 第三批：依赖整改与剩余发布阻断](./docs/current/OPTIMIZATION_S0_BATCH_03_DEPENDENCIES.md)
- [2026-10-12 全面检查分析](./docs/current/PROJECT_AUDIT_2026-10-12.md)
- [V84–V90 持续开发总方案](./docs/current/V84_V90_ROADMAP.md)
- [V84 当前任务与验收](./docs/current/V84_AGENT_CORE.md)
- [产品定义](./docs/current/PRODUCT.md)
- [技术架构](./docs/current/ARCHITECTURE.md)
- [当前状态](./docs/current/STATUS.md)
- [开发任务](./docs/current/TASK_BOOK.md)

`docs/archive` 保存历史设计与阶段报告，仅用于追溯，不作为当前开发依据。

## 仓库结构

```text
apps/api       NestJS API 与权威运行时
apps/mobile    Expo React Native 客户端与 Android Bridge
apps/admin     Next.js 运营后台
packages       数据库、共享合同、连接器 SDK 与配置
docs/current   当前权威产品和工程文档
docs/archive   历史资料
infra          本地与部署基础设施
scripts        发布、迁移、安全与仓库门禁
```

## 本地开发

```bash
pnpm install
pnpm docker:up
pnpm db:migrate
pnpm dev
```

Admin 使用已有管理员账号登录，运行时设置确切 ADMIN_PUBLIC_ORIGIN；本机与公开HTTPS配置见 [Admin运行说明](./apps/admin/README.md)。

常用验证：

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm repository:hygiene
pnpm data:truth
pnpm migration:safety
pnpm terminology:check
pnpm audit:dependencies
```

生产数据库迁移保持 append-only。外部副作用必须经过 Risk、Approval、Execution、Verification 与 Audit；结果不明确时进入 `OUTCOME_UNKNOWN`，不得盲目重试。
