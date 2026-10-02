# 懒人装甲 Lazy Armor

懒人装甲是一个以完成目标计划为核心的个人交付系统。用户表达目标后，系统把目标整理为计划，解析可用资源，在安全边界内持续运行，并以可追溯证据交付结果。

当前统一主线：

```text
Goal → Plan → Resource Resolve → Run → Verify → Result
```

移动端固定五个一级入口：首页、计划、问一问、资源、服务。消息和待处理属于全局注意力入口，个人中心由头像进入。

## 当前文档

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
