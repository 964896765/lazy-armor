# Batch 9B — Gmail 非 Secret 实现与隔离回归报告

日期：2026-09-13；基线 main@87da4ed。状态：非 Secret 实现与完整本地门禁通过；main@fb57464 自己的远端门禁全部通过；**真实 Gmail 账号验收未通过，9B 尚未关闭**。

## 已实现

- 三项 Gmail OAuth 配置契约、缺失 DISABLED/503、部分/不安全配置 bootstrap fail-closed；HTTPS backend callback 和显式 ingress IP/CIDR trust 契约。
- state + S256 PKCE + token exchange + refresh + revoke，复用 CredentialsModule；原 OAuth 表扩展 0046，token I/O 前一次性 CAS claim。无第二套认证表、无 Engine 重写。
- Gmail ProviderAdapter 的五项核心能力，Manifest revision 2、官方证据/实际 Scope Grant/Health TTL/加权限流/标准错误/两项 write VerificationPolicy。
- Generic EmailMessage Parser/Normalizer 与 metadata/body/labels Fact Schema，既有 Observation → Candidate → TruthVersion/Provenance/Strategy 链；用户输入不是 Provider Observation 的代用品。
- 写操作仍走 ActionIntent → Risk/Immutable Approval → Resolver → Existing Runner/Outbox → Existing Verification/Reconciliation。没有直接发送 API，没有写入自动重试，没有提供生产替代 Google URL。
- 未配置的 development/production 不注册历史 Gmail fixture；发布已核对的能力基础，但真实 adapter 保持 DISABLED、connectable=false、不出站。NODE_ENV=test 下保留已有隔离 fixture 合约回归，不宣称 fixture 是真实能力。
- Catalog Sync 将不再注册的历史 handler 标记为当前 DISABLED，保留目录标识与 FK；不删除、不覆盖历史 PlanVersion/Audit。公共 Contract 同步区分现行 handler 与已退休能力。
- 发送批准内容显式固定 from/to/subject/body；授权账号身份变化在出站前拒绝。POST 成功但返回缺失/无效 ID 必须 AFTER_DISPATCH，不能误报“没有副作用”。

实现设计、Scope/配额与官方来源见 [9B design](./runtime-productization-batch-9b-design.md)。

## 专项结果

API Unit + DB/TCP integration + Migration Contract：3 文件 **25 passed**，Start at 13:23:10，13.98s。Gmail unit 12 项、实际 adapter TCP/DB 9 项、Migration 4 项。Config 2 文件 **27 passed**，含缺失/部分/HTTPS/精确路径/no-secret-error 契约。

真实本地 TCP Journey 验证：4 路 callback 只有 1 路交换 token，其他拒绝；失败 token exchange 被消费，不能重复出站；metadata 不能产生正文 Fact；3 路认证邮件读取只有 1 个 Observation、3 个 Candidate/Truth；OAuth 未授予 send Scope 不能手动补造；consent denial 一次性消费。

SEND_EMAIL 真实 adapter 经现有 publish/R3 Risk/审批/Runner/Outbox 绑定，批准内容提交后 TCP 断开；并发 Outbox claim/process 仅一项副作用。Reconciliation 并发 claim 仅一个获胜，纯 GET 查询/回读生成 SUCCEEDED evidence。旧 outbox message 再处理不重发，历史 Operation 保留 outcome_unknown/attempt_count=1。

Refresh/revoke 验证：expiring credential 正常 refresh/新 version；Google revoke endpoint 被调用且本地 Grant/Health 关闭；故意阻塞 refresh 响应、先 revoke、再释放响应，最终 connection/ref 仍 revoked、Health 全部 PERMISSION_REVOKED，不复活连接。429 经真实 adapter 的三次有界只读重试后，连接 degraded、Health RATE_LIMITED/不可用；重新 profile 验证成功才恢复，不伪造健康。

## 完整门禁进度

Monorepo build 8/8、typecheck 8/8；Mobile 16 文件/99 项、SDK 4 文件/50 项已通过。47 个迁移、destructive=0、Drizzle segmentation 通过；0046 已在隔离 MySQL 应用/重放，nullable columns 与 source checksum Contract 通过。Production dependency audit：无已知漏洞。

最新 Full API：**78 文件 passed、1 文件 skipped；487 passed、4 skipped / 491**，Start at 13:23:49，431.47s。完整 Monorepo：**16/16 successful**，7m35.765s；build **8/8**（20.165s）、typecheck **8/8**（17.811s）。Gmail 专项与 Full API 均使用完成安全修正后的同一源码与重建后的 worker dist，不在全量执行期间重建 worker。

Repository hygiene **624 tracked files OK**、Production data-truth **passed**、cached diff whitespace **passed**。跳过项保持既有环境相关门禁，不把 skipped 算作已执行验收。自己的远端 CI（包括 MySQL 8.4 / Backup-Restore / Android Candidate）需独立核验，不能继承 9A 的远端证据；本地通过不是 Final Runtime FULL GREEN。

最新源码日志：`.data/batch-9b-build-verified.log`、`.data/batch-9b-typecheck-verified.log`、`.data/batch-9b-focused-verified.log`、`.data/batch-9b-monorepo-verified.log`。历史失败日志保留：第一次修正历史能力退休/Parser Catalog 计数契约；第二次全量期间补安全测试，运行中的旧模块不含新检查，已统一重建后重跑，不把失败隐藏成通过。

## 单独记录的真实验收缺口

当前没有真实 Gmail Client ID/Secret/Redirect 配置或用户实际 Google 测试账户授权。未读取用户真实邮箱、未向真实收件人发信。status API 的 oauthConfigured 不表示账户验收，realAccountAcceptance 仍 NOT_VERIFIED。

Secret 通过安全本地配置/secret manager 注入，不粘贴聊天、不提交 Git。回调 URI 必须精确 `/api/providers/google/oauth/gmail/callback`，部署 HTTPS ingress 需显式 trusted proxy allowlist。之后跑 OAuth/refresh/Scope/真实读取/测试草稿/测试发送/revoke/429/断网/unknown/write-readback 全部验收，再关闭 9B。

缺 Secret 仅暂停该真实账户验收链；不再把它解释成停止非 Secret 开发。Calendar 已开始官方接口核对与接入设计，见 [9C design](./runtime-productization-batch-9c-design.md)，不是实现完成或真实账号验收；继续复用 GoogleOAuthClient 和同一公共 Provider Runtime，不重造认证、Execution、Truth、Risk 或 Verification。

## 自己的远端门禁与后续安全回归

main@fb57464acc320522e928dc6890406faa83d29d07 的 [release-candidate-ci #65](https://github.com/964896765/lazy-armor/actions/runs/34740518418) 已独立核验：Fast Gate（103679325066）、RC Full Gate（103679585709）、Android Verification（103679585715）全部 success。RC Full 含 MySQL 8.4 Migration / Integration / Backup-Restore；Android Candidate 属于编译与既定隔离门禁，不等于 Google 真账号或 Android 真机验收。

- MySQL artifact 10312585006：`mysql84-migration-evidence-fb57464acc320522e928dc6890406faa83d29d07`；digest `sha256:20ac30a47076c4b5efa26b995e031c6a7e126ab01393a128fb682219dfd5ba97`。
- Android artifact 10312493660：`android-verification-fb57464acc320522e928dc6890406faa83d29d07`；digest `sha256:41f18eea7bc722e0e3710247524ba50e786dbf2cd7ef9a2d06fa8c0e32a9b218`。

9C 接入时修正 Gmail 写后读取 403/404 的安全分类：读失败不代表已完成的 POST 无副作用，必须 OUTCOME_UNKNOWN/AFTER_DISPATCH/definitiveNoEffect=false。新增实际 Adapter 单元回归（Gmail unit 现在 13 项），保留既有 Manifest revision 2 / Evidence revision 1 / Policy revision 1 不变。真实 Gmail 仍 NOT_VERIFIED，不能因为 #65 成功关闭 9B。
