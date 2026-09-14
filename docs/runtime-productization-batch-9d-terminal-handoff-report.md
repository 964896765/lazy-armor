# Batch 9D — PR/Workflow terminal SILENT_FOLLOW_UP handoff

日期：2026-09-14。输入代码基线 `main@fdfc2c18f194ed2df214268d58659fae022d2a83`，Versioned Truth 里程碑 `f6752cb`。本报告记录非 Secret handoff 增量，不关闭真实 GitHub 账号验收，不标整个 9D/FULL GREEN。

## 实现

- 增加 `work.tasks@2`（PullRequest merged）和 `work.recurring_work@2`（Workflow completed）注册定义；保留原 96 个 canonical @1 和 8 个 StrategyProfile @1 不变。未给 PR 假套 EmailMessage，不接受任意客户端 AST/field/action。
- 正式 Compiler → PlanVersion → Binding API 物化 EXACT_SUBJECT 的 Truth Dependency Index；subject 固定 connection/repository/resource/id。默认编译仍是 DRAFT，不宣称已达到真实执行 Readiness。
- 复用现有 deterministic AST：CHANGED AND EQ terminal。初次终态快照仅作 baseline；open、running、已终态后 metadata/conclusion 更新不发终态通知。实际 API 的 merged/status/conclusion 是依据，签名 webhook 的业务字段不是事实。
- 现有 Generic Versioned Truth 的 mutable parent 元数据增加服务器 read fence（connection/auth reference/version/capability）；历史 nullable 记录必须经真实适配器重读才可获得 fence。未修改历史 TruthVersion/value/evidence。
- `POST /api/strategy-runtime/wakeups/:id/handoff`、后台 execution-worker role drain，复用现有 ExecutionDispatch/ActionIntent/Risk/Approval/ExecutionRunner/Notification/Record。历史 Decision 不改写；`DISPATCHED` 只表示 Execution 创建/交接，不代表通知已完成。
- 服务器 proof 固定 Wakeup/Binding/Decision/PlanVersion/definitionHash/runtimeHash/TruthVersion/valueHash/subject/auth reference/version。交接与既有 Execution 创建在同一个锁事务；DISPATCHED/Execution ID 也同事务。现有 Execution user/requestId unique identity 是 durable claim，不新增另一个执行引擎或可失效 worker lease。普通手动入口不能占用 `strategy:` 请求命名空间。
- Guard 复查 active owned PlanVersion、注册场景与编译定义、Binding/Dependency/Decision hash、parent Truth 当前 version/status/reality/confidence/freshness、用户/Connection、Manifest 官方开放/实现/资源字段/purpose、legacy READ permission、Grant/Scope、实际凭据存储与版本、repo snapshot、Health。等待较晚 Truth 锁或 Audit 后再次核对期限。
- 已入队后，每个 terminal local Action 在同一授权锁事务重新核对 proof；既有 Notification/Usage 持久化使用这个事务，最后 deadline fence 失败一起回滚。不放宽任何脱敏规则；proof 只含非 Secret `authRefId/authVersion`。
- 既有 Risk 只增量改为按 Binding scenario revision 查询注册定义，风险计算/上下文升级/审批算法不改。

## Migration / API / 回归

`0049_strategy_terminal_handoff.sql` 只 ALTER 既有 Truth/Wakeup 的四个 nullable 字段并增加 claim index，无历史 DML、DROP/TRUNCATE，无新 Truth/Execution 表。50 个 migration safety/segment 检查通过，TEST 数据库 forward migration 成功。重放校验旧 Version hash/evidence 不变，新 migration checksum 纳入既有 ledger contract。

专项 5 文件 **75/75**：新规则单位测试、签名 HTTP/实际 Adapter TCP/MySQL handoff、历史 Strategy 回归、Migration 回归、GitHub 写后 Verification/未知副作用隔离回归。最后专项日志 `.data/batch-9d-terminal-focused.log`，2026-09-14 22:22:10 开始、49.86s。

覆盖 PR/WF 正式 API Binding Journey、并发 handoff/replay 一条 Execution/Notification、乱序旧 PR 读取不倒退 Truth、不因 metadata 更新通知、停用/permission/独立 Grant 撤销、正式凭据 API 单调旋转、Health 到期、Truth 冲突/已 superseded/stale、历史 READY 保持不可变但不能新授权、precheck 后撤权、入队后撤权、后段 Truth 锁/Audit 等待到期整事务回滚。既有写后网络断开与并发 Reconciliation 的隔离测试继续使用实际 Adapter/TCP/MySQL，不冒充真实 GitHub。

完整 Monorepo/Full API、build、typecheck 正在执行；结果完成后补充。不得用 Signed Webhook 基线 [CI #69](https://github.com/964896765/lazy-armor/actions/runs/34832033652) 的成功替代本增量自己的远端门禁。

## 真实验收与后续

只读检查 root `.env` 和当前 process：GitHub OAuth 三项与 Webhook Secret、Notion OAuth 三项均未提供值（不输出 Secret）。真实 OAuth/hook/权限/撤权/429/Issue-Comment 读写验证和真实账号 terminal Journey 未执行，9D 保持未关闭。缺 Secret 只暂停相应真实验收，继续 Notion 和跨 Provider 的非 Secret 实现。

执行目标按用户最新修订为 9E → 9F → Batch 10 Wave1 **46** → Batch 11 Mobile → Batch 12 其余 **50** → 96/96 Coverage Gate；96 项目录或隔离测试不能自动等同 96 个真实场景通过。
