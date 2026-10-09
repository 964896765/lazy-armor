# P1 真实故障验收（2026-10-07）

Plan Detail 主体冻结；仅修真实数据、状态、审批语义 bug，不扩布局、Skill仓库或 Target。P0 Phase 1 已收口，overall legacy 去权威化继续，迁资产留 P6。

P1 CLOSED 必须同时保留正常定时 Golden Flow 和下列关键故障的真实证据。合同测试与真实 Evidence 分开记录，不用 fixtures 补验收。

| 故障组 | 接受标准 | 已有真实证据 | 当前 |
| --- | --- | --- | --- |
| 权限撤销 | 到点前撤销 Calendar 权限；不发生写入；产生可处理权限缺口 | R3 15:19 到点、真实 read/Truth、write 无 Task/Event、WAITING_RESOURCE、真机日程需要你处理 | REAL_VERIFIED |
| Target 离线 | 到点设备离线；进入可解释等待；上线续同一逻辑运行，无重复副作用 | 初始16:03离线：实际到点receipt恢复同slot→event12→VERIFIED/ACK→next WAIT；R3 dispatch离线独立保留 | REAL_VERIFIED（含修复后恢复） |
| Worker/App 中断 | 提交或执行中断后恢复；lease/fencing 合法；无重复副作用 | event8 App restart、event9 Worker committed-result restart、R3 queued/pre-write App/Worker重启 | PARTIAL_REAL |
| Result/response 丢失 | 副作用已发生后 completion 响应丢失；重传同结果，无新写入 | event7/8 completion response-loss、retained receipt replay、one event/operation/result | REAL_VERIFIED（已有 scope） |
| ACK 丢失 | ACK 已提交但响应丢失；App 重启后重传同 ACK，无新写入；reassessment/next WAIT | event11：upstream201后响应丢弃，相同ACK hash重传、单event11、COMPLETE→WAIT | REAL_VERIFIED |
| stale epoch/authority | 实际授权变化；旧任务/结果被拒绝，无新增副作用 | R2真实权限epoch13→14→15，旧Task 409、retained Result 409、无写/新Truth | REAL_VERIFIED（500另核查） |
| OUTCOME_UNKNOWN | 不自动重写；进入 Reconciliation；权威验证或人工处理 | event14：真实readback mismatch→Ledger/ACK→lookupOnly→NEEDS_USER，单operation attempt1/单event | REAL_VERIFIED |

复用：`artifacts/v83-native-calendar-real-fault-evidence.json`、`artifacts/v83-native-write-response-loss.json`、event8 journal前后；`artifacts/v83-p1b-real-final-evidence.json` 与 event9 自动恢复证据。它们不改写成所有 scheduled fault 均通过。

暂停/版本替换/审批过期等既有可靠性约束继续保留；未验边界明确 Pending。不得为了关闭矩阵降低 freshness、注入 Plan/Truth、手工 schedule tick 或旁路 Approval。

关闭后立即进入 P2 USER_EVENT：默认内部提醒只消费内部日程权威和 ScheduleProjection，无外部 Calendar Invocation；明确要求外部同步才走既有 Resolver/Risk/Approval/Verification。

14:53 第二轮实际到点：native read→VERIFIED/ACK→fresh Truth→NBA EXECUTE，write permission DENIED导致同一wake WAITING_RESOURCE，未生成写Invocation/Task，CalendarProvider查询无该标题。发现待处理投影缺口并修复：读取当前ACTIVE版本的pending resource-wait，不改Runtime状态机；实际页面验证与恢复续行仍等待部署后核对。

R2恢复已真实完成：Android APK安装恢复同组WRITE权限→原wake自动续审批→手机批准→event10→read-back VERIFIED/Ledger/ACK→post-write Replan→10月8日14:53 WAIT。随后暂停验收Plan。待处理修正部署前权限已恢复，因此不冒称该UI验收完成；R3继续真实重试。


### R3 恢复闭环与 ACK-loss（2026-10-07）
Plan `01a11535-4316-74a8-b971-6f80f220c7a3`，冻结版本 `01a11535-431b-777c-a965-436d5573d057`。真实恢复 WRITE_CALENDAR 后原 wake 自动续审批；手机批准后停止 App、移除 API reverse，write Task 保持 PENDING/attempt0，实际 Runtime 投影 WAITING_DEVICE。重启 Worker 未新增 Invocation 或事项。恢复 App 后同 Invocation `01a1153d-993f-7649-b3a2-8fc6299a852f` 创建 event11，read-back VERIFIED；只有一个 write Task/Invocation，attempt1。

真实 ACK proxy 在 upstream ACK 提交201后丢弃响应；App 重启后重传同一 ACK requestHash，未重新写入。Result `01a11543-ea6e-74aa-a358-ba429affc610`，真实 post-write Assessment COMPLETE→Replan→WAIT，nextRunAt `2026-10-08T07:19:00Z`。验收完成后通过 canonical status 暂停 Plan，保留版本和证据。

证据：`artifacts/v83-p1-fault-r3-final.json`、`artifacts/v83-p1-r3-real-ack-loss.json`、`artifacts/v83-p1-fault-r3-offline-runtime.json`、`artifacts/v83-p1-fault-r3-after-worker-restart-runtime.json`、`artifacts/v83-p1-fault-permission-r3-events-verified.txt`、`artifacts/v83-p1-fault-r3-paused-after-completion.json`。

矩阵增量：Result/ACK-loss 为 REAL_VERIFIED（event8 response-loss + R3 ACK-loss）；Target offline 为 PARTIAL_REAL（scheduled write dispatch 阶段，初始到点离线仍 Pending）；Worker/App 为 PARTIAL_REAL（queued/pre-write 与既有 committed-result 恢复，mid-executor/lease expiry未验）。stale epoch、OUTCOME_UNKNOWN仍 Pending，P1 overall OPEN。

恢复后 Target OFFLINE 投影发现代码缺口：设备心跳仅资源页刷新发送，Runner idle poll及claim lease heartbeat未续设备存在心跳。Runner 每次轮询接入既有签名 heartbeatDevice，失败不继续 claim/execute；25项 runner/client/storage测试通过。此修正尚未安装新APK，不能宣称真机在线恢复通过。



Heartbeat真机：APK `1AFC3FD14D5174FA73EAF1190A499FDD34E712775EA51E7352E36C7C771E6F6E`安装后，日程页无Task执行、未打开资源页，lastSeen 07:54:24.492Z→07:54:54.528Z、ONLINE、epoch13；read-only collector没有发送设备心跳。证据v83-p1-heartbeat-idle-1/2.json、v83-p0-p1-heartbeat-idle.png/xml。REAL_VERIFIED。第三样本在会话页空闲，另记scope，不误称仍停留日程。

Initial due-offline修复后REAL_VERIFIED：16:03真实到点receipt，Target OFFLINE/无写。原source不可用时未入队、越过due minute恢复丢slot的问题已真实发现并修复。恢复只重用scheduler实际观察receipt的slot身份，当前ACTIVE owned PlanVersion/冻结trigger/source contract仍是权威，freshness不变，Audit不修改。Worker自动恢复同16:03 slot→唯一read Task→Approval→event12→VERIFIED/两个ACK→COMPLETE→次日16:03 WAIT。真实Plan 01a1155c-abd7-71ed-a7df-d91724750de1，版本01a1155c-abda-705b-be31-b2262e2fa42a。证据v83-p1-initial-offline-due.json、restored-after-minute.json（修复前失败）、final.json、events-written.txt、paused.json。不把修复前行为标成通过。stale epoch/unknown继续Pending。

Stale epoch R2 core：REAL_VERIFIED。正常18:54scheduled Plan/Approval/epoch13 write claim回复丢失前未执行；实际permission revoke/restore→epoch14/15，旧Task/Invocation签名claim均409 STALE_NATIVE_AUTHORITY，permission恢复AVAILABLE后仍拒绝，真实Calendar无R2事项，无write Result/Truth。旧event13 retained Result delivery在新epoch下409 STALE_AUTHORITY_EPOCH。Evidence v83-p1-stale-epoch-r2-real-fence.json、target/resources-revoked/restored.json、events-restored.txt、old-result-fenced.json、final.json。首轮event13未命中注入只记普通成功；中间500不当fence证据，核查Pending。R2lease自然过期→同Task PENDING现场保留。Runner公平性小修打包中，OUTCOME_UNKNOWN仍Pending；P1 OPEN。


OUTCOME_UNKNOWN：event14 REAL_VERIFIED。真实19:10 scheduled Plan/Approval写入后，标准debugger暂停首次readback，仅修改唯一测试event14的真实title；原Executor+server独立比对自然OUTCOME_UNKNOWN。retained result自动恢复瞬态500→Ledger OUTCOME_UNKNOWN/ACK；一个operation/attempt1、一个event14、原write1、lookupOnly readback1，同Invocation。回查实际mismatch→NEEDS_USER，真机展示需要核实/不能重发；Plan continuation RECONCILE/nextRunAt null。证据v83-p1-outcome-unknown-real-edit/final.json、event14-final.txt、result-ready/reconciliation-ui.png/xml。不把NEEDS_USER说成VERIFIED/NEXT WAIT，acceptance明确允许人工处理。暂停验收Plan；case/Event/Evidence保留。既定approval timeout/pause/version项继续核对。


### 20:05 既定边界收口
审批真实过期、到点前暂停、版本替换后的下一轮实际运行均REAL_VERIFIED。同Plan v1审批超时不写；v2暂停跨19:50无执行；v3真实20:02自动调度→UI审批→event15 VERIFIED/ACK→COMPLETE→次日20:02 WAIT。旧Execution保留v1，新Execution绑定v3，版本hash不变；测试后UI暂停。证据v83-p1-v3-final-first.json、v3-authority-after-complete.json、v3-event15-read.txt、v3-paused-confirmed.json及此前expiry/pause证据。

P1仍OPEN，唯一矩阵收口重点为Worker/App已有PARTIAL_REAL项与lease expiry/mid-executor证据范围核对，不新开故障案例或P2。详情旧版本失败待处理与英文摘要为真实语义缺口，500根因尚未证明修复。

P1-L1新增审计见P1_LEASE_RECOVERY_AUDIT.md。Worker heartbeat过期token自续租缺口已修，隔离执行回归33/33通过；尚未部署/取得L2–L6真机crash/commit-gap/fencing证据，P1 OPEN。

21:30 P1-L：lease修复已部署；v5真实Worker进程终止→自然expiry→Worker18408 takeover=true/attempt2已证实。v4旧holder恢复未派发、precommit process death与event16单副作用/WAIT保留。v6新commit-gap注入未命中，JDWP handshake失败后正常成功，不算新unknown/reconciliation通过。expiry→lookup-only→resolved自动回归14/14通过；resolved-case continuation已部署但真机Pending。P1 OPEN，stale terminal/complete拒绝与新commit-gap→Truth→WAIT仍待验。详见开发台账。

22:08：B/C REAL_VERIFIED。event18实际commit-gap→自然write lease expiry→原Task FAILED/unknown，不create重派→lookupOnly→Verification/Truth→RESOLVED→真实Assessment COMPLETE→次日21:52 WAIT。原unknown Ledger/hash保留。cron字段缺口已修，错误COMPLETE checkpoint与恢复后WAIT同时保留。A终态owner事务校验已修/部署，33项通过，但真实旧token探针调试失败，不算拒绝，A REAL_PENDING，P1 OPEN。详见开发台账及event18证据。


### 2026-10-07 22:35 P1 final closure — stale holder REAL_VERIFIED

P1 = CLOSED。既定 fault matrix 冻结，Calendar reliability 验收线结束；当前主线切换 P2 Internal Schedule / USER_EVENT，不提前开展 Skill、Provider/MCP 或新增 UI。

同一真实 Plan `01a1161c-3862-727e-be05-aea254960bf8` 的 v8 经真机自然语言草稿、用户确认/启用，22:25 真实 scheduler 触发。Execution `01a116c0-fbe4-76de-a0bc-1773f01bdfaa`、PlanVersion `01a116bb-e817-76bf-ab5b-4d43b5b1402e`。标准 Node inspector 在原 Worker32808 的 pre-side-effect 边界捕获真实 token（仅内存保留、证据只存 SHA256），未注入数据库、任务或 Result。

原 lease 14:25:08.727Z → 14:25:38.727Z 自然过期。Replacement Worker32112 14:30:53Z 对同 Execution takeover=true/attempt2，进入 WAITING_APPROVAL 后按既有协议释放 lease。本轮不审批写入，未生成该标题的 write Task。

原 Worker 的实际 token 续租返回 false；通过现有 ExecutionStateService.transition 与 executionOwnerContext 分别尝试 failed、succeeded，均真实抛出 ConflictException 409 / STALE_EXECUTION_LEASE。属于真实部署服务方法探针，不宣称经不存在的 HTTP terminal endpoint 发送；Worker terminal transition 正是 Ledger capture 的入口，未增加生产后门。

拒绝前后 Plan、Execution/lease owner、Invocation、DeviceTask、steps/attempt相关状态、Result Ledger/verificationState、operations/cases、回读 Truth 及 Audit 一致。恢复旧 Runner 追加一条 conditions_met 过程事件；初次完整比较因此 pass=false，原证据保留，复核确认无 authority/terminal/result/Truth mutation 后 reviewed comparison pass=true。不能把该过程事件描述成完全没有任何新日志。

证据：artifacts/v83-p1-a-ownership-real.json；v83-p1-a-old-owner-expired.json；v83-p1-a-after-takeover.json（早于实际takeover，保留为观察中样本）；v83-p1-a-takeover-worker-real.log；v83-p1-a-before/after-stale-request-authority.json 与 lease.json；v83-p1-a-stale-fence-authority-comparison.json（初次差异）；v83-p1-a-stale-fence-reviewed-comparison.json（复核通过）；v83-p1-a-paused-final-verified.json（UI暂停已服务端确认）。B/C event18 evidence、原 OUTCOME_UNKNOWN Ledger 与次日21:52 WAIT 保留不动。

关闭依据：既有 Worker death/natural takeover + 本轮真实 stale-terminal fencing + event18 commit-gap/lookup-only/verified Truth/resolved continuation/WAIT + 同 Invocation 无重复副作用 + unknown Ledger不可变。原33/33执行合同及14/14写入恢复回归保留，本轮未修改生产代码，未用自动测试替代真实拒绝证据。
