# Production Readiness Checklist

## 已验证

- [x] P0-7 Approval → Runtime Guard → Idempotency → Transactional Outbox → Test/Mock Provider
- [x] Runtime 使用 credential current version，不信任历史 Plan 授权快照
- [x] Credential expected-version concurrency 与 restart persistence
- [x] Android AAB 可构建；生产签名配置缺失时 fail-closed
- [x] Public Connector API 不泄露 risk/retry/side-effect internal metadata
- [x] OAuth state 服务端生成；callback/reconnect/revoke 契约存在
- [x] File content 不落数据库、不落 Audit，只保留 SHA-256 与最小 provenance
- [x] Mobile production API URL 缺失、非 HTTPS 或 loopback 时 fail-closed

## 生产前必须完成

- [ ] 正式 Android keystore 签名与证书核验
- [ ] Android 真机 SecureStore、restart、refresh rotation、invalid refresh、failure matrix
- [ ] 部署环境实际生产 API URL、TLS 与网络连通性验收
- [ ] Webhook H3 全矩阵
- [ ] Worker liveness/readiness/signals/Redis/MySQL outage 全矩阵
- [ ] 各真实高风险 Provider 独立 Production Gate

## 强制关闭

- Calendar 外部创建/更新、Content 正式发布/Analytics、真实 Logistics、真实支付/转账/账户权限修改均保持 disabled，直到对应专项 Gate PASS。
