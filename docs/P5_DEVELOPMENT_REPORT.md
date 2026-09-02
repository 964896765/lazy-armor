# 懒人装甲 P5 Development Report

## Status

\`IN PROGRESS\`

\`Current Stage = P5 Commercialization & Scale\`

## Current Workstream

\`P5-A Membership + Entitlement\`

目标：

1. Free / Plus Membership 数据模型。
2. 集中式 EntitlementService。
3. Active Plan 数量限制。
4. 安全能力永久绕开收费限制。
5. Mobile Membership 页面。

## Production Gates

- 会员支付第一阶段仅允许 Sandbox；真实 Payment Provider 保持 \`DISABLED / DEFERRED\`。
- 不复用 P1 财务领域 \`BillingModule\` 作为会员支付模块。
- Permission revoke、Disconnect、Approval、Risk、Credential revoke、数据管理、删除账号与 Security Notification 永不因套餐或额度被阻断。
