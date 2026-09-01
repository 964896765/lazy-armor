> **懒人装甲不是帮用户拥有更多功能，而是帮用户少做更多事情。**

> **能不打扰就不打扰，能不让用户操作就不让用户操作；但越自动，后台越必须安全、透明、可追踪、可撤销。**

# 懒人装甲

个人事务自动化平台。品牌主张：从从容容，游刃有余。

当前阶段只建设统一底层的 P0 技术设计，不进行大规模业务编码。

## 文档

- [P0 统一底层技术设计](docs/P0_TECHNICAL_DESIGN.md)
- [P0 第一轮现有项目审计](docs/P0_ROUND1_AUDIT.md)
- [P0 第一轮完成报告](docs/P0_ROUND1_COMPLETION_REPORT.md)
- [P0-4 Plan Engine Core 完成报告](docs/P0_4_COMPLETION_REPORT.md)
- [P0-5 Execution Engine Core 完成报告](docs/P0_5_COMPLETION_REPORT.md)

## P0 设计冻结原则

- 所有领域共享一套 Plan Engine、Connector Framework 和 Execution Engine。
- 领域能力只能以 Connector、Template 和受控 Action 扩展。
- 已启用的 PlanVersion 不可修改；每次执行永久关联当时版本。
- 外部副作用必须经过权限、风险、审批、幂等和审计链路。
- 正常成功默认静默；异常和需要用户操作的事项才打扰用户。
- 第一阶段保持模块化单体，不拆微服务。

## 本地开发

要求 Node.js 20+、pnpm 9+ 和 Docker Desktop。

```bash
pnpm install
docker compose -f infra/docker/docker-compose.yml up -d
```

复制 `.env.example` 为 `.env`，将 `JWT_SECRET` 设置为至少 32 个字符，并将 `CREDENTIAL_MASTER_KEY` 设置为随机 32 字节的 Base64 值。随后执行：

```bash
pnpm db:migrate
pnpm --filter @lazy-armor/api dev
pnpm --filter @lazy-armor/admin dev
pnpm --filter @lazy-armor/mobile dev
```

API 默认位于 `http://127.0.0.1:3001/api`，健康检查为 `/api/health`。数据库迁移只前进，不在应用启动时删表、清表或覆盖 seed。

## 当前实现范围

当前实现停在 P0-5：除 P0-1～P0-4 的基础架构、身份、Connector 与 Plan Engine 外，已实现正式 Execution / ExecutionStep、受控状态机、BullMQ Worker、Lease/Heartbeat/Crash Recovery、Step 级 Retry/Fallback、运行时 Connection/Permission 校验，以及 Mobile 真实执行记录与详情。P0-6 Risk/Approval/Notification 与 P0-7 Audit/业务 Idempotency/Transactional Outbox 均未开始；R2～R4 Action 在这些安全能力完成前一律阻断。
