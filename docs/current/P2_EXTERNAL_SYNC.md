# P2 Phase 2 — 显式外部同步

2026-10-08 22:56 最新：**P2 CLOSED / REAL_VERIFIED**。指定APK已安装，真实UPDATE/DELETE、permission/offline/unknown隔离、重复来源及签名交付、Worker/Outbox/App重启均达到冻结验收标准。32项最终复核见[关闭证明](../../artifacts/v83-p24-final-acceptance-reviewed.json)，详细边界见文末关闭记录。P1保持CLOSED；可靠性线冻结，下一批P3。下文早期checkpoint保留为历史记录。

## 早期合同 checkpoint（后续状态见P2.3）

`packages/plan-schema/src/user-event-sync.ts`定义独立External Sync Intent、UserEventExternalLink和同步建议判断。Intent仅包含手机日历目的地、CONFIRM_CHANGES策略与明确durationMinutes，不能包含批准状态、Target授权或外部身份。持续时间缺失需澄清，不能偷偷把提醒时间当结束时间。

Link关联owner、USER_EVENT、Target、真实外部身份、已同步内部版本及Invocation/Verification引用。VERIFIED或已同步版本必须具备完整证明引用；字段校验不是Truth Authority，只有后续服务读取正式Verification后才可写入。

同步建议与实际派发分开：未同步时create建议，已有真实身份且版本变化时update建议；取消提出delete建议；完成不自动删除外部事件。RUNNING/WAITING_APPROVAL不派发新请求，OUTCOME_UNKNOWN优先Reconciliation，即使内部已取消也不跳过现实回查。owner/identity错配和未来已同步版本fail closed。update/delete能力尚未接入，不把建议冒充已执行。

共享合同与原内部事项合同合计10项通过，plan-schema typecheck通过。当前Planner仍对显式同步返回CLARIFICATION_REQUIRED，不提前开启尚无执行承载的入口。

## 当前代码耦合审计

已新增RuntimeAuthoritySource严格区分PLAN与USER_EVENT_SYNC。PLAN必须完整保留owner/planId/planVersionId；USER_EVENT_SYNC必须绑定owner/requestId/userEventId/version/contractHash，禁止混带Plan身份。当前只支持这两种受控来源，不虚构已实现的Temporary/Service来源。

0082_user_event_sync_authority持久化不可变确认请求，唯一owner/proposal确保幂等；同一确认事务校验最新assistant草稿、会话owner、内部事项版本和输入，再冻结合同并审计。该服务尚未接入公开确认入口，不存在用户自行提交authoritySource的后门。

RuntimeAuthorityService作为现有Runtime的来源权威校验门：原NativeCalendarRuntimeService的Plan检查已调用此门，仍要求active/current PlanVersion；USER_EVENT_SYNC按事务校验已确认合同hash、owner、事项身份/版本及输入。编辑/取消/撤销后禁止新WRITE，RECONCILE可消费原始冻结请求以处理未知结果，不授权新的create。它不替代Target权限、Approval、lease或Verification。

迁移仅应用隔离*_test数据库。6项真实数据库合同测试通过，包括确认幂等、篡改输入/hash、跨owner/混合Plan来源、编辑取消后write拒绝与原请求lookup保留；原native write14项回归通过，共享12项通过，API typecheck/build通过。这些是自动化合同证明，不是真机多来源Runtime Golden Flow。

## Multi-authority-source Runtime 实现

0083使Execution、ActionIntent、Invocation及其审批/执行记录支持受控非Plan来源。Plan引用完整保留；非Plan的空引用必须绑定完整USER_EVENT_SYNC来源，Execution还必须保存冻结执行定义。数据库CHECK与共享schema共同fail closed。旧Plan记录与canonical hash不回填、不改写。

Dispatcher、Resolver、Risk、Approval、Runner、ActionAdapter、Invocation和Native DeviceTask沿同一执行体系运行。USER_EVENT_SYNC使用不可变确认请求及定义快照，不创建Plan/PlanVersion，不添加调度器。审批与派发前重新检查owner、事项版本、确认合同和Target权限；编辑、取消或撤销后不能派发旧WRITE。签名结果与lookup-only使用RECONCILE门记录原版本现实，不能借此授权新写入。

0084仅增加独立resultProjectionJson，确认contractJson/hash保持不可变。RuntimeSourceContinuationService要求已提交Ledger、正式成功Verification、server-owned Truth引用；unknown路径还要求对应ReconciliationCase已经RESOLVED。通过后持久化UserEventExternalLink、Ledger/Verification/Truth/case引用。原unknown Ledger不改写，内部USER_EVENT不被标成完成，也不因同步失败受损。

关联记录实际执行的userEventVersion。内部已编辑时CHANGE_PENDING，已取消时CANCEL_PENDING；它们是外部变更待确认语义，不会自动update/delete。来源交接通过现有Outbox恢复循环重试，锁确认请求并幂等写入，覆盖Truth提交后、continuation前的进程中断。

新增集成测试使用隔离确认fixture和签名collector：覆盖无Plan执行、旧版本审批拒绝、取消后unknown lookup、独立身份关联及continuation恢复/幂等。不是AI/Android CalendarProvider真机证据。

## 尚待完成

合法Planner/确认和原Runtime审批已接入并部署。真实Calendar create/commit-gap/lookup-only/Truth/link及重复恢复已CORE_REAL_VERIFIED。剩余重复来源事件及编辑/取消产品语义仍待验收；自动化集成与真实读取/确认不能视为Phase2 CLOSED。P2仍IN_PROGRESS。


## 2026-10-08 P2.3 Planner Confirmation & Real Sync Acceptance

Planner支持显式PHONE_CALENDAR同步草稿；持续分钟数必须来自明确用户输入，缺失或不匹配fail closed/要求澄清，Google等不偷换目的地。草稿不授予执行权，客户端确认接口只接收version/messageId/confirmed，不能提交Runtime来源、Invocation或目标。

confirm-user-event在同一事务创建内部事项与不可变Sync Request。重放保留原confirmedVersion，即使内部事项后来编辑，旧合同不改变。Planner对来源Truth做owner/context白名单校验，并由服务端冻结草稿时的确切TruthVersion/valueHash；不在确认时偷偷换成最新版本。

UserEventSyncLaunchService只从已确认请求启动现有Dispatcher。手机日历范围由冻结的NATIVE_OS来源推导，设备/日历必须唯一且读取证据新鲜；Resolver选到另一设备时拒绝。同一Execution优先replay，不依赖今天资源状态；尚未形成Execution时可重评只读Resolution。合法start入口不接收客户端calendarId/Target；确认到派发之间的中断通过原Outbox恢复。

五套API自动回归38/38、共享22/22通过。0082–0084已应用真实部署；迁移前后7类旧Plan/Runtime/Ledger/Truth权威数据按原列hash不变。新版API、ExecutionWorker、OutboxWorker已启动并ready。

真实Source确定使用现有Android日历读取链。真机合法读取10项，真实DeepSeek生成USER_EVENT_DRAFT和显式同步，UI确认冻结来源12个TruthVersion。首轮未形成Execution：安装的P2 APK验签公钥为空，Native Manifest如实报告calendar.create UNAVAILABLE，Resolver fail closed；没有写入，也没有改坏内部事项。当前重建含正确验签公钥的APK，未将首轮计为同步成功。

真实审批/写入/Verification/link与P2来源重复、编辑、中断、验证晚到验收仍待完成。P1 CLOSED，P2 IN_PROGRESS。严禁将38项测试或本次读取/确认当作P2 CLOSED。


### P2.3 核心链 REAL_VERIFIED（07:29）

真实DeepSeek audit modelProvider=deepseek；R3引用本次实际读取的3个TruthVersion，来源在dispatch时新鲜。内部事项01a118ab-2f6b-7241-9b6b-e98b0412826d，sync request 01a118ab-c0de-721e-9b4e-27fa1738f634，Execution 01a118ab-c340-769a-b905-0441c76e067b，Invocation 01a118ab-c371-7778-924c-f0a2395efd16，均无Plan/PlanVersion。

UI确认只形成待审批；独立审批后标准JDWP断在CalendarInvocationExecutor:138。CalendarProvider真实event19已存在，Native Journal PREPARED/deviceOperationId=19且没有result，服务端无Result。真实App force-stop后自然lease expiry提交OUTCOME_UNKNOWN；真实重启ExecutionWorker/OutboxWorker/App，原case的lookup-only找到event19，正式Verification/Truth提交，case RESOLVED，来源交接保存Link VERIFIED/lastSyncedUserEventVersion=1。再次真实重启后只有一个原写Task、一个lookup Task、一个Invocation、一个真实event19，原unknown Ledger UUID/state不变。

交接完成时ACK仍null，之后ACK真实完成。18项复核见artifacts/v83-p23-real-sync-acceptance-reviewed.json；旧UNKNOWN Execution保持历史failed，不回写成功，来源结果由已解决的后续现实证明解释。

### 产品投影部署 checkpoint（后续真机校验见下节）

只读GET /user-events/:id/external-sync严格owner隔离，展示有效同步状态；Link历史版本保持v1，内部版本变更派生CHANGE_PENDING，内部取消派生CANCEL_PENDING。建议标记requiresApproval=true、executionAuthorized=false、availability=NOT_IMPLEMENTED；本次仅支持首次create，不假装update/delete已运行。个人事项页展示中文状态，不增加Runtime/Skill/CalendarEngine入口。

新版投影API及APK C18785A96BC74C189ED50BBD1C545DAD82107E88E734D7C2384D548449E90B40已部署，API/Mobile类型检查、9项集成与构建通过。手机当前锁屏/AOD，已请求用户解锁，页面中的已核对/编辑后未更新/取消后外部保留尚未真机确认。首轮v2编辑与v1合同保留已真验；不能将其替代成功同步后的编辑/取消验收。

重复来源事件仍待真验；当前晚Verification已证明unknown Ledger先提交、reconciliation后提交真实证明，不额外扩充正常terminal Result变体作为关闭条件。P2保持IN_PROGRESS，P1 CLOSED，P3等不进入。

### 13:14 event19 生命周期与请求重放 REAL_VERIFIED

真机进入已同步事项，实际页面显示“已同步并回读核对”。通过UI延后15分钟，内部由v1升至v2；由于原时间已经过去，按现有延后合同以操作时刻为基准，新的时间为13:22，并非09:35。页面显示内部更改、外部更新需另行确认。通过UI取消并确认外部不会自动删除，内部升至CANCELLED v3，页面显示外部删除另行确认。CalendarProvider仍保留event19原09:20–09:50。此处是真实POSTPONE时间修改，不宣称另外验过标题EDIT。

使用现有公开确认/start协议和合法owner会话，各重放3次。确认返回同一个事项/Sync Request、原confirmedVersion=1且executionAuthorized=false；start返回原Execution。取消后的v3未被旧确认覆盖，Link仍绑定实际执行v1，原unknown Ledger、Invocation、Verification、Case与冻结请求不变。没有新增Execution或Task。证据复核27项通过：artifacts/v83-p23-event19-lifecycle-reviewed.json。属于真实部署协议重放，不是额外UI点击，也不替代重复Observation/App delivery的专项证据。

update/delete合同准备：新增user-event-sync-confirmation.v2，固定UPDATE/DELETE、前次已验证请求、Target/device、calendar/eventId、operation marker及Verification引用；要求新事项版本晚于已同步版本。历史v1解析不加默认字段，不改变canonical bytes。单对象update/delete参数禁止泛化查询，Android更新保留无邀请限制。当前编译门明确SYNC_MUTATION_RUNTIME_NOT_IMPLEMENTED，不能把新变更合同误编译成create；未部署变更执行能力，UI仍明确NOT_IMPLEMENTED。新增共享合同28项与API拒绝门2项通过，API/共享typecheck通过。

下一步接通服务器生成变更建议与确认、独立Approval、现有Shared Runtime、真实update回读/delete缺失Verification和Link外部状态；完成不删除。P2继续IN_PROGRESS，不进入P3。


## 2026-10-08 P2.4 / P2.5 执行接入 checkpoint（真机未验收）

UPDATE/DELETE已接入现有USER_EVENT_SYNC→Resolver→独立Risk/Approval→Invocation→NativeCalendarRuntimeService→DeviceTask→同一CalendarInvocationExecutor。服务端从旧Link及正式Verification生成变更建议，客户端只提交version/messageId/confirmed；确认冻结v2请求，不接受客户端Target/外部event身份。WRITE对UPDATE要求active/current事项版本，对DELETE仅允许对应cancelled/current版本；历史lookup仍只消费冻结来源。既有create的合同、Task类型和审批不迁移。

外部变更限定同一Target/device/calendar/eventId及上次验证的operation marker；Native UPDATE/DELETE先持久化PREPARED再调用CalendarProvider，已有journal或lookupOnly只读回查，不重新写。更新按标题/时间/时区/新marker回读；删除只在保留提交前合法身份观察时接受缺失证明。删除写独立calendar_event.presence Truth，不虚构日程时间；新Link为DELETED/externalState=ABSENT，旧请求/Verification/unknown Ledger保留。内部COMPLETE不提出外部update/delete。

新增calendar.update/calendar.delete独立grant，android-local-v4清单；旧v2/v3仍接收，但缺失新能力会撤销其旧可执行投影。Resolver按能力对应grant解析，只允许确认的原设备/Target；permission恢复后用当前authority/manifest投影重新解析，同一Sync Request仍唯一Execution。最小目录迁移0085仅注册delete身份及update/delete别名；真实迁移前后7类核心权威hash相同。

隔离API主回归28/28（旧Native14、Authority6、SharedRuntime6、定义编译2）；并发注册修复及来源执行补充7/7，Shared28/28，Mobile Runner19/19、类型检查与API/Shared/Android构建通过。签名collector合同测试覆盖permission拒绝不损坏v2、update与delete未知结果的lookup-only→Truth→Link、原unknown Ledger不改写、COMPLETE不删除。它们不是真机CalendarProvider证据。

首次同时部署时ExecutionWorker因新absence adapter注册竞争退出；已修幂等注册且保留不可变hash核验，补充并发回归通过后重建/重新部署。部署记录artifacts/v83-p24-runtime-deployment-r2.json；保留首次失败记录。新版APK SHA256 BB039F73037AEDFA4B6BA067EE399CD1B50CAF0DBD145062AA8045AB6F076CF7已构建，ADB当前无连接设备，尚未安装。

P2.4/P2.5状态：CODE_IMPLEMENTED / BACKEND_DEPLOYED / REAL_PENDING。真实update/delete、permission/offline/failure隔离及duplicate Source/delivery仍待手机验收；手机缺失不能替代为offline验收证据。event19仍保留既有现实证据；本checkpoint未对它执行新外部变更。P1 CLOSED，P2 IN_PROGRESS，不进入P3。


## 2026-10-08 22:56 P2 最终收口 — CLOSED

指定APK已真机安装；UPDATE保持event20身份、DELETE缺失Verification、permission/offline隔离、UPDATE unknown只读回查、真实签名回执/来源重放、Worker/Outbox/App重启均通过冻结验收。完成仅内部生命周期，原unknown Ledger与历史合同/证明保留。最终[32项真实复核](../../artifacts/v83-p24-final-acceptance-reviewed.json)全部通过；[完整验收与限制](P2_FINAL_ACCEPTANCE.md)记录真实UI、既有owner协议和JDWP观察的各自范围。

本轮修复UTC自动恢复查询、Drizzle包装重复签名错误500→409、completed回执重放误标CHANGE_PENDING；9项签名权威回归、7项multi-authority集成及API构建通过，修复均部署/对应真路径复验。内部提醒交付仍限定持久化站内通知，Android OS push尚未验收。USER_EVENT/Calendar sync可靠性线冻结，P1 CLOSED、P2 CLOSED；下一主线P3 ResourceGap Auto Resume，本批未开始P3实现。
