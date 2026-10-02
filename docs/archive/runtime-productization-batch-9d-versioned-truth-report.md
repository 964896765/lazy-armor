# Batch 9D — 连续资源 Truth 子步骤

日期：2026-09-14；开发基线 `main@607e0b01db094efc3dd6184c25704dbeacb5fb3c`。这是 GitHub 9D 的增量 Reality Pipeline 子步骤，不是整个 9D 或真实 GitHub 账号验收。

## 增量实现

继续使用既有 SourceObservation / CandidateFact / TruthRecord / TruthRecordVersion / Provenance / Strategy enqueue / Audit；没有新 Truth Store 或领域 Engine，也没有重写 Execution、Risk、Approval、Strategy 或 Verification。

前向 migration `0047_generic_truth_identity.sql` 仅扩展既有 TruthRecord：nullable `fact_identity_hash` + unique index。稳定身份包含 user、connection、resource type/key、subject、fact，不包含当前 value。原来的 receipt unique、version unique、Provenance unique 和 restrictive FK 保留。原有 47 个 SQL 不修改；历史 nullable 身份不猜测、不回填、不合并，旧 billing/notification/v1 TruthVersion 不改写。

新的 `generic.repository-resource.v2` / `repository-resource.v2` 与 freshness/conflict policy 以新 key 注册；旧 v1 key、revision、hash 不变化。v2 单独命名空间去重，实际 API value 不添加虚构字段；四种资源必须具有实际 provider updatedAt 及匹配的 resource hint。

仅由服务器实际 READ adapter 生成 acquisition proof（Capability、凭据版本、request ID、acquiredAt）。发布事务锁定并复核拥有者/连接、实际 read permission、Grant、Health、Credential version、正式 Manifest 与资源边界；撤权或旋转先提交时旧读取不能发布。外部 GET 在事务之外完成，不在数据库锁内等待网络。公开 Candidate confirm API 不能通过请求正文注入 acquisition proof。

同一资源实际值变化只追加既有不可变 TruthVersion 与 Provenance；唯一稳定身份、现有 version unique 与候选行锁处理并发。相同值的实际再次读取仅刷新可变 TruthRecord verifiedAt 并追加 Audit，不改写旧 Version/Provenance，不产生新的 CHANGED wakeup。乱序更新标记候选 SUPERSEDED，不回滚当前版本；相同 provider 时间却不同值标记 CONFLICT，将父记录置 conflicted、阻断后续自动发布，不采用 last-write-wins。冲突人工处理尚未实现，不能自动声称已解决。

GitHub readback 迁移到上述 v2。Repository 的 updatedAt 来自实际 GET 字段，不使用本地观察时间猜测 provider ordering；旧 OAuth / 写入 / 回查规范化的默认行为保留。Manifest github@2 / Evidence@1 / RuntimePolicy@1 未原地修改，Webhook 仍关闭。逐资源确认不是多资源批次整体原子事务。

## 测试与门禁

最终专项 API **4 文件 / 41 项通过**（03:44:41，14.53s）：GitHub Provider 14、隔离实际 Adapter TCP/MySQL 15、Migration contract 6、local ingestion concurrency unit 6。新增 TCP/MySQL 用例通过真实 adapter/API/事务完成连续 PR 三版本、三并发仅追加一次、旧版本完整保留、相同值 revalidation、乱序 SUPERSEDED、相同时间 CONFLICT、用户伪造 proof 拒绝、实际 GET 尚未完成时权限撤销或凭据旋转先提交导致发布拒绝；新版本凭据再次真实 GET 能正常发布。保留原有一条 POST 已产生副作用后 TCP 断开 → 并发 Outbox/只读 Reconciliation → 不重复 POST 用例。

稳定事实身份单元测试 **11 项通过**（03:30:57，797ms）：v1 hash 不变、v2 去重隔离、状态改变身份稳定、六维身份隔离、真实 updatedAt 缺失/非法拒绝、resource hint 校验。迁移契约验证 0047 实际 source checksum、nullable legacy 记录可并存（隔离事务回滚测试数据）、无 backfill DML、旧 unique constraints 保留和 ledger 重放不变。

最终 typecheck **8/8**（19.046s）；build **8/8**（24.734s）；migration safety **48 files/destructive=0**、Drizzle segmentation、测试库前向 db:migrate 和 production data truth 通过。初次 typecheck/build 的 draft 类型过窄已定位修复，重跑通过，没有压制类型错误。

首次完整回归出现一项并发 READ 500，597 项通过 / 4 项跳过，Monorepo 15/16，不作为 green 证据。错误安全边界没有输出 SQL；随后同一 TCP/MySQL 套件独立运行 10 次全通过，不能因此忽略首次失败。新增授权事务锁带来 FK/unique 并发死锁风险，Generic 摄取补有界 local INSERT deadlock 重试（最多初次 + 3 次），不重发 Provider GET 或任何外部写入。保留部分 autocommit 已保存身份，不伪造新的 observation。新增 unit 验证嵌套 MySQL code、精确身份复用、retry 上限和其他错误不重试；TCP/MySQL 诊断只保留安全数据库 error code，不泄露 SQL/凭据。首次 500 的确切数据库 code 没有历史日志，不声称已经证明其根因。

修正后 Full API **86 文件通过 / 1 文件跳过；605 项通过 / 4 项既有跳过，共 609 项**（03:45:27，440.56s）；Monorepo **16/16**（7m41.67s）。本次包含原有 Plan/Risk/Approval/Execution/Outbox/Audit/Truth/Strategy/Provider/Android session 的完整 API 回归，不以专项通过替代全量。GitHub 15 项 TCP/MySQL 套件在完整回归再次通过，安全诊断没有收集到数据库 error code；不将这一成功冒充首次 500 确切根因证明。stage 后 hygiene **661 tracked files**、cached diff whitespace、依赖审计（无已知漏洞）通过。

本子步骤将作为独立 main 提交推送，远端 CI 待其自身 SHA 验收。`607e0b0` 的 CI #67 仅支持旧核心 SHA，不作为本次源码的远端验收证据；没有标本子步骤远端 FULL GREEN。

### 后续独立远端证据（2026-09-14）

上述待推送是开发时的历史状态。实际源码提交为 `f6752cbe5833b4ba13a708f3555dbe651f94320b`，[CI #68](https://github.com/964896765/lazy-armor/actions/runs/34779065452) 对应同一 main SHA，PR Fast Gate `103782592509`、RC Full Gate `103782938032`、Android Verification Artifact `103782937972` 均 success。API REST artifact 元数据核对 head SHA 一致、expired=false：

- MySQL 8.4 migration evidence `10323614451`：`sha256:563a76ee258b50c5a1b6725424344401d23443b76bc8502fb3ac96f87a5d914b`。
- Android verification `10325312677`：`sha256:aa53aacadf6d06a88c1bc5d08d9b19ae69a64b4b0c37761891f127af1f7d093a`。

该远端证据仅支持 f6752cb 的连续 Truth 子步骤，不支持后续 Webhook 源码，也不代表真实账号/Provider Journey 验收或整个 9D 关闭。

日志：`.data/batch-9d-versioned-regression-focused-final.log`、`.data/batch-9d-versioned-typecheck-regression.log`、`.data/batch-9d-versioned-build-regression.log`、`.data/batch-9d-versioned-monorepo-final.log`；首次失败 `.data/batch-9d-versioned-monorepo.log` 与十次专项 `.data/batch-9d-concurrency-diagnostic-1.log` … `-10.log` 保留。

## 未完成与后续

完整 GitHub signed Webhook ingestion/recovery/重放并发验收、版本化 Scenario/Fact 映射、terminal Condition、PR SILENT_FOLLOW_UP → 既有 Execution 通知 Journey 未完成；本步骤不手工制造依赖或把 PR 伪装成 EmailMessage 事实，也不自动升级 96 场景 Readiness。updatedAt 变化本身不是 merged/failed 的业务终态。接下来按增量路线继续这些 9D 非 Secret 功能，再推进 9E/9F 与 Batch 10/11。

没有真实 GitHub 账号授权、真实 repository webhook、真实 Issue/Comment 写入或真机验收；OAuth Secret 只阻塞相关真实账号验收。不得关闭 9D 或标真实 GitHub 完成 / FULL GREEN。
