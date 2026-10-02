# Batch 9A — Provider Runtime Common Layer

日期：2026-09-13。状态：实现与本地适用门禁已完成，准备推送 main 验证远端 CI；未宣称本批远端 FULL GREEN。

## 基线与范围

Batch 6～8 冻结基线为 b679250，两项 CI bugfix 后的 main@311f472 已由远端完整 CI #63 验收为 FULL GREEN，包含 Android AAB。该远端标记不适用于后续提交。最高规划与用户执行修订已同步归档，后续仍按 9A → Gmail → Calendar → GitHub → Notion → Cross-Provider 顺序推进。

本批只建立真实 Provider 的公共扩展层，不宣称任何真实 OAuth 账号或平台 Journey 已验收。

## 实现

- SDK：ProviderAdapter 全生命周期、11 类稳定错误、ProviderRateLimitPolicy / QuotaPolicy / RetryPolicy / HealthPolicy / ProviderVerificationPolicy / ProviderErrorMapping / OfficialEvidenceRevision。
- ProviderConnectorBridge 兼容既有 ConnectorRegistry。Provider 写入必须绑定已持久化的 SideEffectOperation，重建并比对既有不可变请求，复用 ActionAdapter 的 Risk / Approval 校验；没有新增公开直接写入接口、Provider Runner 或领域 Engine。
- 官方证据、Manifest 与 Runtime Policy 同事务发布，provider/revision/hash 不可覆盖；证据独立 revision 可引用，旧 Manifest 和策略保留。并发相同内容发布幂等，不同内容冲突；仅对已回滚的元数据死锁事务做有限重试，绝不重试外部副作用。
- Provider Registry 可以安装新 revision；启动时加载持久化 ACTIVE revision，仍保留首批 18 个待核实骨架，不自动声称官方开放。
- Migration 0045 在既有 provider_capability_evidence 增加 5 个 nullable 字段，历史证据不回填、不改写；新增 provider_runtime_policies 仅承载尚不存在的版本化公共策略。两项外键 RESTRICT，provider/revision 唯一；历史迁移 checksum 不变。
- Redis 原有 RateLimiter 增量支持加权单位，INCRBY 与 EXPIRE 通过 Lua 原子执行。公共层 Provider / Connection 的请求与配额预算使用独立命名空间；拒绝不退款，保守计数，避免并发超额调用。
- OAuth / refresh 在实际 I/O 前检查已发布、当前、完整 hash 和审核证据。外部平台须有 VERIFIED 官方文档证据；NOT_REQUIRED 只用于明确内部/OS 输入，不能用于把未知外部官方能力变成可用。
- 运行前按连接归属、当前凭据引用/版本/有效期、官方 Availability、实现、Grant、Health 与 Health freshness 逐项校验。凭据解析复用 CredentialProvider，忽略调用方自带 token，不新建 Secret 存储。
- Health / read / lookup 有界只读重试；Retry-After 超过预算不提早重试。写入/subscribe 在兼容桥内只调用一次；只读 Health / Verification 有界等待，不能把可能已派发的超时改成可重复执行。
- Verification 证据由既有 evaluateVerification deterministic VM 计算并与 Adapter 声明比较。缺失、冲突或不允许的方法不能宣称成功。PARTIALLY_SUCCEEDED 在兼容桥内不冒充成功，转为 UNKNOWN 后由既有只读回查形成最终 partial 证据。
- 模糊写入错误保留既有 NETWORK_ERROR / OUTCOME_UNKNOWN 分类，进入原有 Outbox / Reconciliation；不修改历史 Operation / Execution 终态来制造成功。
- API：operations/super-admin 只读策略列表、当前策略、指定 revision；连接 Owner 专属 provider-runtime 视图。视图的 runtimeRegistered 表示已登记，不等于生产可用或真实平台验收通过。

## 同步修复的生命周期问题

撤销连接时同事务失效 ConnectionCapabilityGrant 和 ProviderCapabilityHealth；Adapter revoke 获取 owner / connection / credential ref 上下文，不做全局撤销。Health TTL 由兼容桥返回并由既有 Connections.validate 投影保留。Health 回写和既有 Connections.validate 都锁定连接并重新检查撤销/凭据版本，防止网络响应晚到后把已撤销连接恢复为 connected / healthy。这些是原有生命周期的安全 bugfix，不重写成熟主链。

完整回归发现自动 refresh 后 Health 比对了刷新前版本，导致正常 validate 返回 409；已改为比对实际用于探测的 request credential version，保留并发换证的拒绝边界。相关连接生命周期、模板生命周期和公共层并发专项 3 文件、20 项通过。另一次模板启动 hook 超时重跑通过，未放宽全局测试 timeout 或跳过该测试。

## 已通过专项

专项 API / DB / Migration：3 文件、15 项通过。包含 4 路同 revision 发布、不可变冲突、证据 revision 升级与重加载、鉴权/归属/只读 Contract、过期 Grant / Health 无出站、加权配额并发、撤销与 Health 回写并发、真实旧 Health 响应晚到不得复活连接。

完整新桥 Journey：真实本地 HTTP/TCP 服务器在 POST 时产生副作用后立即断开响应；现有审批与 Runner 正常通过，多路 Outbox claim 和重叠 process 最终副作用只有一次；Operation 为 outcome_unknown / attempt_count=1；多路回查 claim 只有一个获胜，GET 产生 SUCCEEDED VerificationEvidence，历史 Operation 仍为 outcome_unknown，重新处理旧消息不再执行。

SDK 专项包含 schema、错误、Scope/Expiry、hash、写入上下文、只读重试/超时、授权证据前置校验和网络中断；API unit 直接复用既有 Verification VM。

## 完整门禁

最终完整回归通过：Full API 76 文件通过、1 文件按既有条件跳过，465 项通过、4 项按既有条件跳过；monorepo test 16/16；build 8/8；typecheck 8/8。SDK 4 文件、50 项通过；Mobile 16 文件、99 项通过。Production Dependency Audit 无已知漏洞。Migration safety：46 文件，destructive=0，Drizzle segmentation 通过；新迁移已在隔离测试库应用并重放，历史 ledger 不变。Repository hygiene 检查包含全部新增暂存文件的 606 个 tracked 文件通过；production data-truth gate 通过。git diff --cached --check 通过。

完整回归日志本轮 Start at 10:28:25，API duration 400.29s，monorepo duration 7m2.085s。后续提交的远端 FULL GREEN 必须由该提交自己的全部 CI jobs 决定，不能继承 main@311f472 的 Android 或 MySQL 8.4 证据。

追加 Batch 9B 预检报告后再次执行 repository hygiene：607 个 tracked 文件通过。

日志：.data/batch-9a-focused.log、.data/batch-9a-sdk.log、.data/batch-9a-full-build.log、.data/batch-9a-typecheck.log、.data/batch-9a-monorepo.log、.data/batch-9a-migration-safety.log、.data/batch-9a-hygiene.log、.data/batch-9a-truth.log、.data/batch-9a-audit.log。

## 下一步

2026-09-13 远端追加验收：main@87da4ed58d4924470bb2baa232b570ab8ac36256 的 [CI #64](https://github.com/964896765/lazy-armor/actions/runs/34733518570) 三项 job 均 success：PR Fast Gate 103660657675、RC Full Gate 103660915526、Android Verification Artifact 103660915561。RC Full 为 463 passed / 6 skipped；本地 465/4 与远端条件跳过差异不混写。MySQL 8.4.11 的 migration / checksum replay / backup-restore 同提交通过。

Android artifact 10310847154：`android-verification-87da4ed58d4924470bb2baa232b570ab8ac36256`，digest `sha256:99340ca5c9663005f668a343fc522ad9a99a02eb02c42b6af57e4428ac238774`；MySQL artifact 10309829147，digest `sha256:a61bb0d4c8f98a884fd96cec9f8d8c7f525cf6d5c10612fdfe695bc15327deed`。这证明 9A 同提交远端门禁全绿，不代表 Gmail、真机 Beta 或最终 Runtime RC 已验收。

下述预检停顿解释已由 [2026-09-13 执行修订](./runtime-productization-execution-revision-2026-09-13.md) 覆盖：缺 Secret 仅阻塞真实账户验收，9B 非 Secret 实现和隔离测试继续。保留原预检记录用于追溯。

公共层适用门禁完成后已直接进入 Batch 9B 预检。仓库加载的 .env 以及 Process / User / Machine 环境均未发现 Google / Gmail / OAuth 配置变量，仅输出变量名称和计数，没有输出任何 Secret 值。缺少真实 OAuth Client Secret 触发既定 Hard Stop；详见 [Batch 9B 预检报告](./runtime-productization-batch-9b-preflight-report.md)。不得用现有 Gmail fixture、图片里的官方开放示例或本地网络测试冒充真实平台接入。9B～9F 未完成，也未越过依赖开始 Batch 10～14。
