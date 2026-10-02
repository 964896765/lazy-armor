# Batch 1 — Capability Foundation 开发报告

> 基线：`main@7f0cb36b6359dd6b6823026355aba5cf7e2380e5`  
> 状态：完成  
> 日期：2026-09-08

## 交付结果

- 建立 `ProviderCapabilityManifest`、Evidence、Revision、Connection Grant、Capability Health 的共享类型与数据库模型。
- 首批 18 个 Provider 以保守骨架进入 Registry；所有未经核实的官方能力均固定为 `TO_VERIFY_OFFICIAL`，实现状态固定为 `NOT_IMPLEMENTED`。
- 独立表达四个现实维度：Provider Availability、Implementation Reality、Connection Grant、Runtime Health；可用性解析默认 fail-closed。
- 新增不可变 Manifest Revision 同步服务、受运维角色保护的 Registry API、用户连接级四维能力 API。
- 现有 `connection_permissions` 和 Connection Validation 以事务方式双写新 Grant / Health 投影，未改写现有 Connection、Execution、Risk、Approval 或 Audit 主链。
- Migration 仅新增结构并回填既有 Permission，不包含 `DROP` / `TRUNCATE`。
- 移动端来源详情页改为读取真实四维能力结果；未知、未授权、失效、限流或 Provider 异常均不会被展示为可用。

## 数据库变更

- `provider_capability_manifests`
- `provider_capability_evidence`
- `connection_capability_grants`
- `provider_capability_health`
- Migration：`0036_capability_foundation.sql`

## API

- `GET /api/provider-capabilities`：仅 `super_admin` / `operations_readonly`
- `GET /api/provider-capabilities/:providerKey`：仅 `super_admin` / `operations_readonly`
- `GET /api/connections/:id/capabilities`：连接所有者可见

## 验证

- Connector SDK：13 tests passed
- Batch 1 API/DB integration：5 tests passed
- Migration safety：37 migrations，destructive=0
- Development/Test database migration：passed
- SDK / Database / API / Mobile typecheck：passed
- Monorepo regression / build：passed

## 架构守恒

Batch 1 仅在现实能力边界新增声明、授权与健康投影。所有后续能力解析仍须汇入既有 `Source → Trigger → Condition → Action → Risk → Approval → Execution → Result → Fallback → Audit` 主链；未创建领域专属 Engine，也未重写 Execution Engine。
