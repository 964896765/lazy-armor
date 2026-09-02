# Environment Isolation Evidence

更新时间：2026-09-02

状态：CODE GATE COMPLETE / EXTERNAL STAGING RUNTIME EVIDENCE DEFERRED

## 已关闭的代码边界

- Backend 明确区分 `development`、`staging`、`production`，部署环境必须使用 `NODE_ENV=production`。
- Staging/production 拒绝 localhost 数据库、localhost Redis、明文 `redis://`、通配或非 HTTPS CORS、占位 JWT、无效 32-byte base64 credential key。
- Redis/BullMQ 使用环境专属命名空间：`lazy-armor-staging` 与 `lazy-armor-production`；Rate Limit 与 Failure Counter 使用同一命名空间。
- Mobile staging/production 缺 API URL、使用 localhost、HTTP 或无效 URL 时 fail-closed。
- True-process test connector 仅允许 `APP_ENV=development` 且 `NODE_ENV!=production`。
- Public registration 在 production-mode 部署中默认关闭。
- Staging 与 production 提供独立、无真实 secret 的配置模板；真实 secret 只能由部署平台注入。

## 自动化证据

- `@lazy-armor/config` environment isolation：10/10 PASS。
- Mobile API environment resolution：8/8 PASS。
- P0 Final Security：12/12 PASS。
- Config 与 API typecheck：PASS。

## 外部基础设施 Hard Stop

仓库尚未注册真实托管 Credential Provider（Vault/KMS/Secrets Manager adapter）。因此 staging/production API 会主动拒绝启动，且不得回落到本地加密文件 Provider。以下证据必须在部署基础设施可用后补齐：

- 独立 staging MySQL/Redis 的实际资源标识与连通性证据；
- 托管 Credential Provider 的最小权限、rotation 与 revoke 证据；
- staging API/worker 使用同一 staging 命名空间的启动与健康检查；
- production 与 staging 资源、secret、OAuth callback、CORS allowlist 完全分离的部署证明。

该 Hard Stop 只阻断真实 staging/production runtime acceptance，不授权任何高风险 Production Provider，也不阻断 Android Beta 构建与其他不依赖真实凭据的工程工作。
