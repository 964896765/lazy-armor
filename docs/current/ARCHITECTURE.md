# 懒人装甲技术架构

系统沿用 pnpm 与 Turborepo 单仓结构。Plan、Truth、Risk、Approval、Execution、Verification 和 Audit 是权威状态链；AI、Provider、设备、MCP 与外部服务只能作为资源或执行目标参与，不能越过权威服务写入业务结果。

## 运行链路

```text
Mobile or Chat
  → GoalSpec and Plan Draft
  → Plan Authority
  → Resource Requirement and Resolution
  → Plan Offer and User Confirmation
  → Observe and Decide
  → Risk and Approval
  → Execute
  → Verify and Reconcile
  → Result, Attention and Audit
```

## 应用边界

- `apps/api`：NestJS API、权威 workers、Provider、设备调度与审计。
- `apps/mobile`：Expo Router 客户端、Android 原生桥接和消费级状态展示。
- `apps/admin`：运营、证据、故障和发布管理。
- `packages/plan-schema`：计划及运行时共享合同。
- `packages/database`：Drizzle schema、append-only migration 和数据库门禁。
- `packages/connector-sdk`：资源能力与 Provider 适配合同。

## 安全边界

外部副作用必须具备幂等身份、风险判断、必要审批、执行租约、结果回读和审计记录。Provider 超时或外部结果不确定时进入 `OUTCOME_UNKNOWN` 并转为待处理。连接存在、获得授权和当前可执行是三个独立状态，客户端不得自行推断。

## API 收敛

新移动端使用 `/plan-templates`、`/chat/*` 和 `/attention`。旧 `/templates`、`/search`、`/todos` 作为兼容入口保留到旧客户端调用遥测清零后删除。资源和服务聚合 API 仍需继续从底层连接、设备和计划投影中收敛。
