# 懒人装甲 Lazy Armor

懒人装甲是以 Goal 为入口、具备感知、理解、规划、执行和验证能力的个人生活操作系统。系统判断一次性任务、内部个人事项或长期目标，解析真实方法与资源，在授权范围内执行并核实结果。

当前统一主线：

```text
Goal → Context / Planner → Temporary / USER_EVENT / Persistent Plan
  → Skill / Resource Resolve → Shared Runtime → Verify / Truth → Result / Replan
```

移动端永久固定五个一级入口：日程、计划、会话、资源、服务。个人中心由头像进入。当前开发 V84 Agent Core；V84–V90 按能力、用户入口与真实证据同步推进。

## 当前文档

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
