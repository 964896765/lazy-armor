# P1-L1 Lease / Execution 恢复审计（2026-10-07）

本轮唯一范围是用户冻结的 P1-L1–L8；不新增 Recovery Engine，不重跑 event15/ACK-loss 等已验场景。以下是代码审计及自动化证据，不是真机 crash 验收。

| 边界 | 当前实现与恢复入口 | 验收判断 |
| --- | --- | --- |
| Execution Worker | ExecutionLeaseService.acquire 行锁分配 workerToken，30秒lease；Worker每lease/4续租；Queue reconciler恢复队列；Runner边界调用heartbeat | 过期token续租缺口已修；真实kill/takeover待验 |
| Invocation → SideEffectOperation | Coordinator沿既有幂等operation/outbox准备，Android dispatch固定canonical Invocation | 不创建第二恢复authority |
| DeviceTask | claim/heartbeat/complete核对claimToken与lease；OutboxWorker.poll调用recoverExpired | lease过期写Task恢复PENDING，operation executing→retry_wait；必须核实native journal防重复，不把retry_wait等同允许再次insert |
| Android Runner | 保存claimedTask；重启时active lease续租；expired清本地claim再claim同Task；完成结果先落盘再提交 | before-write与around-commit必须分别真机验收 |
| Native OS commit | CalendarInvocationExecutor先同步commit PREPARED，后CalendarProvider.insert；同operation重放只读marker，缺失/无法读回为OUTCOME_UNKNOWN | PREPARED后禁止第二insert，commit-gap真实process death待验 |
| Dispatch ticket | DeviceAppBridge校验服务签名、Invocation/hash、target/epoch、ticket expiresAt，随后调用内部Executor | 旧ticket过期拒绝；校验后长暂停至insert之间的fencing边界仍需核对 |
| Result / Ledger | complete事务锁claim；retained receipt与recoverCommittedResults恢复Ledger | event7/8/11已有证据，不能替代commit-gap |
| ACK / continuation | ACK可靠交付独立于结果；既有Plan continuation验证Truth并幂等Replan | event11/event15已实证，不重新执行这些场景 |
| Reconciliation | native lookupOnly任务沿既有case，只读现实，匹配→RESOLVED，未知/不匹配→NEEDS_USER | event14已验NEEDS_USER；crash-gap存在→VERIFIED仍需真实验 |

## 本轮代码修正与回归
ExecutionLeaseService.heartbeat以前仅核对token，导致已过期但尚未被接管的holder可自行续租。现增加leaseExpiresAt > now及created/queued/running/retry_wait状态条件；保留原acquire入口和token权威。

API build通过。隔离测试DB与独立Redis prefix下p0-execution.integration.spec.ts **33/33通过**；新增自然lease expiry→旧holder不可renew→新holder合法acquire→旧holder被fence→新holder可renew→执行结束不可renew。日志artifacts/v83-p1-lease-regression-natural-takeover.log。未向真实验收数据库写fixture。

首次测试在build未完成时失败；后一次因CJS provider身份和共享队列导致3失败。改用实际CJS provider及独立Redis prefix后32项通过，新增自然lease接管测试后33项通过。保留日志，不把失败称为通过。

## Pending / 禁止提前关闭
服务运行中的进程仍是此前版本；新build尚未重启部署。L2 Worker claim后实际crash、L3 App RUNNING后process death、L4 commit gap、L5 crash-gap read-only reconciliation、L6 stale holder复活均尚未取得本轮完整真实证据。Runner跨await后到dispatch的worker fencing，以及native ticket检查至OS insert间的暂停边界需继续审计。不能仅凭heartbeat修正宣布整体stale-worker fencing完成。P1 OPEN，P2未进入。
