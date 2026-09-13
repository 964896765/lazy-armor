# Batch 9A — Provider Runtime Common Layer 接入设计

日期：2026-09-13。状态：公共层实现与本地完整门禁已完成，最终结果见 [Batch 9A 报告](./runtime-productization-batch-9a-report.md)；本批远端 CI 尚未宣称 FULL GREEN。`311f472` 的远端完整 CI #63 已完成收口，基线 FULL GREEN；真实平台接入仍遵循 9B～9F 顺序。

## 扩展边界

唯一运行链、现有 Runner / Outbox、Risk / Approval、Verification / Reconciliation 保持不变。统一 ProviderAdapter 通过兼容桥转换为现有 Connector，不新增 Provider Runner，不增加领域 Engine。

| 生命周期 | 复用概念 | 本批补充 |
| --- | --- | --- |
| Official Evidence → Manifest | provider_capability_evidence / provider_capability_manifests | 独立官方证据 revision / hash，版本化策略与 Manifest 引用 |
| Authorization → Credential | OAuth state / CredentialProvider / credential_versions | Adapter authorize / refresh / revoke 契约与统一错误 |
| Grant → Health | connection_capability_grants / provider_capability_health | 生命周期策略与权限、有效期检查，未知/撤销 fail-closed |
| Read / Execute | ConnectorRegistry / Connections / existing Execution | ProviderAdapter → Connector 兼容桥；不新增公开直接写入端点 |
| Verification → Result / Reconciliation | VerificationPolicyRegistry / verification_evidence / reconciliation_cases | Provider verify / lookupOperation 输出适配，未知结果不宣称成功 |

## 统一契约

- ProviderAdapter：metadata / capabilities / authorize / refresh / revoke / health / read / execute / verify；lookupOperation / subscribe 为明确可选能力。
- authorize 使用 begin / callback 的 typed request，沿用既有 state / redirect / PKCE 与凭据结果，不能由浏览器自行提供 granted capabilities。
- Runtime Credential 只接收现有 CredentialProvider 解析后的数据或引用，不建立第二套 Secret 存储；revoke 必须有连接上下文，不能按 Provider 全局撤销其他用户。
- Runtime policy 具有 provider / revision / definition hash / evidence revision / manifest revision 身份；持久化 revision 不得覆盖不同内容。
- ProviderRateLimitPolicy / QuotaPolicy / RetryPolicy / HealthPolicy / VerificationPolicy 都需有界参数；未知配额与审核状态不得猜测成生产可用。
- ProviderErrorMapping 输出 AUTH_EXPIRED / AUTH_REVOKED / SCOPE_MISSING / RATE_LIMITED / QUOTA_EXCEEDED / PROVIDER_UNAVAILABLE / RESOURCE_NOT_FOUND / PERMISSION_DENIED / NETWORK_ERROR / TIMEOUT / OUTCOME_UNKNOWN。

## 安全与兼容

1. SDK 层定义统一类型与验证，不依赖 Nest 或数据库。现有 Connector 接口及所有旧 Provider 调用保持兼容。
2. 既有 Registry 承载新的兼容桥；官方 Manifest 和 Runtime policy 明确引用，不能仅凭存在 adapter 方法声明实现 Reality。
3. 官方 Evidence 优先扩展已有表，保留旧记录；新增策略表只承载尚不存在的版本化 policy 概念。迁移仅前向增量，旧迁移 checksum 不变。
4. 不在 Adapter 内盲重试写入。需要重试的动作必须交回已有副作用协调器，未知结果只做只读验证/对账。
5. 网络中断与超时需要区分请求是否已派发。可能产生副作用时不能改写为已知失败，也不能自动再次 execute。
6. 严格区分官方 Availability、Implementation Reality、Connection Grant、Runtime Health；官方文档证据不等于真实账号集成证据，不等于应用审核通过。
7. 验证字段不完整、缺失、冲突、pending / not_found 均保持 OUTCOME_UNKNOWN；Provider response 成功不直接等同于业务成功。
8. 策略 API 只读并鉴权；连接视图必须按当前用户归属检查。新增 Provider 不需要改变 Scenario / Strategy / Plan / Execution Engine。

## 验证清单

- SDK unit：统一错误、超时/网络与派发阶段、未知结果不可重发、有界策略参数、Manifest/证据/策略 revision 不可变、权限缺失、兼容桥路由。
- DB / API integration：新迁移可重放、源 checksum、一致的 Manifest / Evidence / policy 关联、并发同 revision 单记录、不同内容冲突、鉴权/归属/只读 contract。
- 真实本地 HTTP/TCP 隔离测试：已提交副作用 + 响应断开 + 不再次 execute；继续使用现有 Outbox / Reconciliation 机制。
- Full API / monorepo test / typecheck / build / migration safety / repository hygiene / dependency audit；涉及 Mobile 时额外执行 Mobile 门禁。
- 测试 fixture 明确隔离，不能变成生产 Provider fallback；真实 Gmail OAuth / Scope / Token / API 验收属于 Batch 9B，缺少所需 Secret 时按既定 Hard Stop 暂停，而不是伪造完成。
