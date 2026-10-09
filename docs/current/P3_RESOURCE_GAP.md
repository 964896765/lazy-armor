# P3 ResourceGap Auto Resume

2026-10-09：**P1 CLOSED / P2 CLOSED / P3 IN_PROGRESS**。京东临时查询已冻结；同一长期 Plan/v1 的资源恢复、真实空读、后续采集窗口与来源版本/epoch fencing 已取得真机证据。P1/P2 Calendar reliability 线保持冻结。

## 本批结论

| 验收层 | 状态 | 真实范围 |
| --- | --- | --- |
| A ResourceGap Auto Resume | REAL_VERIFIED | 原 Goal 等待资源，正常 UI 恢复许可和采集，Outbox/Resolver 自动继续，只读结果返回原会话 |
| 京东 Notification Acquisition | EMPTY_READ_VERIFIED | 当前手机真实监听器采集授权京东来源，成功回执为 VERIFIED_EMPTY、0 条 |
| Persistent Plan ResourceGap → Auto Resume → 空读 WAIT | REAL_VERIFIED | 原 Plan/v1 自动恢复；当前权限下真实只读，后续窗口继续，旧 Task/Result 保留 |
| 来源版本 / authority epoch 旧请求 fencing 与恢复 | REAL_VERIFIED（限定范围） | 正常 UI 撤销/恢复后，旧真实读取 holder 的 heartbeat/fail/complete 各返回 409；仍为原设备，不宣称物理设备换绑 |
| B Shipment Candidate → Truth | REAL_PENDING | 尚无真实物流通知；没有生产 Candidate/Shipment Truth，不用模拟通知替代 |
| P3 Overall | IN_PROGRESS | 正向物流 Truth、含 Truth 发布与长期 Plan 的真实 Truth/Assessment/提醒闭环尚未验收 |

正式复核：[23项真实证据](../../artifacts/v83-p3-auto-resume-acceptance-reviewed.json)。复核脚本只读取此前落盘证据：[v83-p3-auto-resume-review.py](../../artifacts/v83-p3-auto-resume-review.py)。自动化回归 API 6/6、Mobile Executor/Runner 27/27 分别记账，不能代替真机事实获取。

## 同一原 Goal 的真实连续链

原用户请求：“帮我看看最近京东有没有需要处理的快递。”实际通过手机临时会话发出，要求仅查询授权京东通知，不创建 Plan、不写日历。

| 身份 | 实际引用 |
| --- | --- |
| Conversation | `01a11c37-59ce-76ed-9de4-ae5a0e8b87f6`，version=1 |
| 原用户 Message / Goal | `01a11c37-59f6-77b1-9572-dcdf801da096` |
| ResourceGap Message | `01a11c37-7a6e-7321-81fb-8aca2266206f` |
| 当前手机 TrustedDevice | `01a0fb24-2dc0-719e-a0db-3da7fb52a5d4`；ADB `2c696fe` |
| 当前京东来源 | `01a11c38-f070-746d-a10f-ba2a4ec87a91`；`com.jingdong.app.mall` |
| 保留的失败 Task | `9f083837-a1ce-53e0-8d9f-a95e90528249`，FAILED/result=null |
| 自动恢复后的只读 Task | `b15b69cd-0ad8-58ee-808a-07992d43f293`，SUCCEEDED |
| 签名 Acquisition | `01a11c4c-9436-776e-9ea4-078159670116`，VERIFIED_EMPTY |
| 唯一最终答案 | `01a11c4c-977b-725a-9a38-001689416bcb` |

真实 Planner audit 的 modelProvider/modelName 为 DeepSeek，提出受控 `shipment.status` 查询，package 固定京东、lookbackHours=168。AI 不提供客户端可执行 Runtime 对象。原消息、Goal hash、会话 version 和 owner 始终不变，没有重新问、手工插 Task、注入 Result 或创建 Plan。

授权不足时原查询为 WAITING_RESOURCE，没有 Task/Receipt。旧设备京东连接只保留历史，当前手机的京东连接通过真实应用发现、设备证明和确认添加产生。系统 Notification access、本机用户 grant、京东来源许可分别恢复；监听器必须真实连接，消息获取总开关也必须启用。

首次原生读取因消息获取总开关关闭而 FAILED，记录没有被改成成功。修正清单将总采集暂停呈现为 UNAVAILABLE，页面明确提示“消息获取已暂停”；实际恢复前没有新增读取。正常设置 UI 开启消息获取后，既有 Outbox 自动记录 READ_RECOVERY_AUTHORIZED，再次 Resolver recompute，并为同一 Goal 固定新的只读 attempt。失败历史仍原样保留，此有限重读规则只用于本通知只读 collector，不允许自动重放副作用。

2026-10-09 00:15:43（Asia/Shanghai）实际采集完成，回执为 VERIFIED_EMPTY/items=[]，提交 Acquisition、Task 成功后自动发布原会话答案，ResourceGap=COMPLETED。App force-stop/reopen 后，仍为相同两个读取 Task、相同 Acquisition、同一个最终答案。同期新增 Plan、Calendar Invocation、Calendar write Task 均为 0。

最终产品结果：“当前授权应用的通知读取范围内，没有已核实的物流线索。这不能证明没有快递。”truthRefs=[]、Receipts=0；没有伪造 Shipment Truth。

## 证据范围和实际修正

通知 collector 只读取真实监听器的 active notifications 与本机已授权保留队列，再按京东 package 和冻结时间范围过滤。此次范围为 2026-10-02 00:15:28.843 至 2026-10-09 00:15:28.843（Asia/Shanghai）。这是过滤范围，**不是已取得京东过去七天全部通知历史**。已被清除且从未授权捕获的通知无法由这条链补回；空结果不能证明没有订单或快递。

本批修正监听器遗漏的真实 connected 标记，以及总采集开关未进入能力健康判断的问题。账户切换和撤权清理保留；正文不进入服务器回执，只上传受限 package、时间、指纹和候选字段。Native 失败不会被转成 VERIFIED_EMPTY。

既有候选核实表面已复用账单/物流的最小确认结构：端侧分类只形成 Candidate，只有现有合法核实和 Truth Authority 提交后，原查询才消费物流 Truth。该正向分支有合同测试，尚无本批物流真机数据，不将其标成 REAL_VERIFIED。其他候选类型没有在本批扩展。

| 证据 | 用途 |
| --- | --- |
| [授权前](../../artifacts/v83-p3-jd-denied-real.json) | 原 Goal、DeepSeek proposal、缺口、无 Task |
| [首次失败](../../artifacts/v83-p3-jd-health-recheck-real.json) | 原生拒绝采集；失败 Task 真实历史 |
| [采集暂停](../../artifacts/v83-p3-jd-paused-real.json) | UNAVAILABLE → WAITING_RESOURCE；无新增读取 |
| [自动恢复](../../artifacts/v83-p3-jd-resumed-real.json) | 同 Goal/版本、attempt2、Outbox 重算、真实 Task |
| [最终读取](../../artifacts/v83-p3-jd-final-read-real.json) | 签名 Acquisition、空结果、COMPLETED、唯一答案 |
| [App重启后](../../artifacts/v83-p3-jd-after-app-restart-real.json) | 结果和读取身份持久化、无重复答案 |
| [暂停截图](../../artifacts/v83-p0-p3-acquisition-paused.png) / [最终截图](../../artifacts/v83-p0-p3-jd-final-result.png) | 实际产品状态 |
| [部署](../../artifacts/v83-p3-runtime-deployment-r2.json) / [安装](../../artifacts/v83-p3-apk-install-r3-real.json) | API/Workers 和最终真机 APK；SHA256 `8C0E2D115FCB091490ECD463FBC2233F98A4BF4770D82BB203609409407EA7F4` |

## 后续仍待核实的边界

### 2026-10-09 冻结的剩余关闭范围

按用户最新确认冻结 P3 最终 DoD。已完成的临时查询、长期 Plan/v1 空读恢复及来源 fencing 保持冻结；剩余只收三条真实业务 Truth 闭环，不追加 ResourceGap 类型或 SMS、Provider、MCP、Windows、Service 验收。

| P3 最终 DoD | 状态 |
| --- | --- |
| Temporary Goal ResourceGap Auto Resume | REAL_VERIFIED |
| Persistent Plan ResourceGap Auto Resume（空读 / 等待分支） | REAL_VERIFIED |
| Resource health / collection state 真实反映 | REAL_VERIFIED |
| sourceVersion fencing | REAL_VERIFIED |
| authority epoch fencing | REAL_VERIFIED |
| 旧 Task / Result / Ledger 保留 | REAL_VERIFIED |
| 重启恢复（已记录范围） | REAL_VERIFIED |
| 空读不推断“没有快递” | REAL_VERIFIED |
| 真实 Shipment Candidate → 用户核实 → Truth | REAL_PENDING |
| 含 Truth 的结果发布一致性 | REAL_PENDING |
| Truth → 异常 Assessment → 站内提醒 → post-result WAIT | REAL_PENDING |

| 剩余项 | 当前状态 | 必须保留的权威边界 |
| --- | --- | --- |
| 真实京东 Shipment Candidate → 用户核实 → Truth → 新查询结果 | REAL_PENDING | 新查询 / 新采集窗口；不制造通知，不改写历史 VERIFIED_EMPTY |
| 含 Truth 的结果发布一致性 | REAL_PENDING | 发布事务再次检查当前来源许可、sourceVersion / authority epoch 和 Truth 当前版本 / 撤回状态 |
| Persistent Plan 正向业务闭环 | REAL_PENDING | 同一个已确认 Plan/v1 消费真实 Shipment Truth，按冻结规则确认异常，站内提醒后进入 post-result WAIT |

首条长期目标限为“以后有京东快递异常时提醒我”。通知指纹和 Receipt 身份表示一条通知线索，不冒充订单 / 运单身份；只有用户核实的真实异常状态可触发提醒，不能从空读或长时间无更新猜测物流异常。临时 Goal 与长期 Plan 复用既有通知 collector、DeviceTask、Reality / Truth 和 Runtime，恢复由既有 Worker / Outbox 推动，不增加第二套调度器或事实权威。

三项取得连续真机证据后，直接标记 P3=CLOSED，冻结京东通知可靠性验收线并切换下一阶段。当前没有真实物流通知，P3 保持 IN_PROGRESS。普通物流状态只能按原规则等待，不能为验收将其强行认定为异常；提醒必须由满足冻结异常规则的真实、已核实 Truth 触发。协议测试与构建不能替代这些真机证据。

### 当前动作：等待真实业务数据，不继续扩展开发

保留原通知 Plan/v1 和既有合法采集窗口，等待真实京东物流通知。通知到来后，经现有 Collector → Candidate → 用户核实 → Truth，再分别完成含 Truth 的发布一致性及原 Plan 的异常 Assessment → 站内提醒 → post-result WAIT。普通物流通知可以证明 Candidate/Truth 与发布分支，但不能单凭通知存在就关闭异常提醒分支；用户核实不能将普通状态改造成虚构异常。提醒验收仍为持久化站内通知，不追加“用户处理完毕”或 Android OS push 为关闭条件。

空读恢复后的 Assessment/WAIT 已有真实证据；尚缺的是消费真实业务 Truth 的异常判断与提醒。ResourceGap 使用通用恢复合同，本轮真机证明限于 Android Notification 的 Temporary Goal 与 Persistent Plan，不能扩大表述为所有 Connector 均已真实验收。后续 Target 复用合同，在各自阶段验收其特有接入边界，不加入本轮 P3。

当前主线仍为P3；P4计划体验、P5Service Runtime、P6Skill仓库均属后续。等待真实业务数据时可以提前准备P4/P6设计，但不开发。后续方法与资源组合中，Skill提供识别、判断与处理方法，Resource提供真实能力，仍经受控Planner/Runtime/Truth链；Skill是按需的0～N个方法，不拥有来源授权或Truth权威。准备稿见 [P4计划体验](P4_PLAN_EXPERIENCE_DESIGN.md) 与 [P6方法/资源组合](P6_SKILL_RESOURCE_COMPOSITION_DESIGN.md)，阶段口径见 [V83_MAINLINE.md](V83_MAINLINE.md)。

纯自动 `requestRebind` 独立验收尚未完成，**不属于本轮 P3 DoD，也不是关闭 blocker**；实际跨设备换绑及历史快照未观测的单条 Delivery/ACK 仍如实保留证据边界，不据此新增 P3 必验项或重新打开 P1/P2。只有用户明确修订 P3 DoD，才能加入新的关闭要求。

### 剩余范围实现 checkpoint（2026-10-09）

受控 `notification.shipment-watch.v1` 已接入真实 Planner 可用来源 metadata、CreationDraft 与合法确认。确认冻结京东通知范围，不能虚构运单。通知 Plan 通过同一 `app.notification.read` Invocation / DeviceTask / Runner / Ledger 读取；既有 Worker tick 每 5 分钟建立一次采集窗口，每窗口最多 3 次受控恢复，原 PlanVersion 不变。完成空读后仍会取得新的窗口，旧 Task / Result 不被追加或改写；后台系统推送不属于这个合同。

来源许可 / epoch / sourceVersion 在 claim、heartbeat、fail、complete 与结果发布处统一 fencing。Receipt 记录服务端冻结的来源 binding 和稳定事件证据；重新授权后必须由新的真实只读 Task 重新观察才能消费跨 epoch 的旧事实，旧 Receipt / Truth / provenance 不改写。通知重新捕获仅改变 capture 时间时，可以用相同的稳定事件证据证明同一事件，不能接受内容变化。

结果发布事务锁定原 Goal、当前来源及每条确切 Truth 版本。通知 Plan 的站内提醒提交也重新过 Truth / source guard，并按 PlanVersion + TruthVersion 幂等，不能把不同通知线索合并为一条“这个快递”的提醒。当地现实事实未知或未核实时保持等待。

自动化证据：Temporary source / publication 回归 14/14、Receipt provenance 13/13、Receipt / Truth adapter 17/17、Persistent Plan 生命周期 4/4。长期测试包含先空读、后两个新窗口异常事实、各一次提醒、post-result WAIT；全部为隔离测试，不冒充真机物流证据。最终部署和真机状态以本页后续真实 checkpoint 为准。

### 长期 Plan 与来源恢复真机 checkpoint（2026-10-09，Asia/Shanghai）

真实 DeepSeek Planner 经手机会话、CreationDraft 确认、启用冻结版本和开始运行，形成“以后有京东快递异常时提醒我”。确认与模型审计已由只读一致性快照保留；不是客户端直接制造 Task。

| 冻结身份 | 实际值 |
| --- | --- |
| Plan | `01a11e56-22b8-75ba-a888-7ac702815eb3` |
| PlanVersion | `01a11e56-22bc-711c-95ec-c8ef0a53c07c`，v1 |
| Contract | `01a11e56-22ec-7395-88fb-1624fd944c59` |
| Definition hash | `0c3a1a691e31d15facd81a5ca59bfdea769634d34863bedaed619431bc31b69a` |
| 京东来源 / Device | `01a11c38-f070-746d-a10f-ba2a4ec87a91` / `01a0fb24-2dc0-719e-a0db-3da7fb52a5d4` |

09:48:57 ACTIVE Plan 为 WAITING_RESOURCE，Task/Invocation=0。用户 grant 与系统权限恢复后，监听器仍未连接，系统继续等待；没有把权限已开误当成 AVAILABLE。通过 Android 正常设置重新连接监听器（系统敏感权限确认由用户完成）后，09:58:12 原 Plan/v1 自动完成第一条读取：

`WAITING_RESOURCE → READ_RESERVED → READ_PENDING → 原生通知读取 → VERIFIED_EMPTY → Invocation Ledger SUCCEEDED/VERIFIED → WAITING_FACT_CHANGE / WAIT`。

| 真实 Task | 窗口 / attempt | 当前来源 authority | 结果 |
| --- | --- | --- | --- |
| `a759ff5a-bcd6-576e-85bc-76cf3e50c326` | `5971703` / 1 | epoch 29，原 sourceVersion | SUCCEEDED / VERIFIED_EMPTY |
| `bd04a04c-0be9-5d33-8829-09cb08611708` | `5971704` / 1 | epoch 29，恢复后的 sourceVersion | SUCCEEDED / VERIFIED_EMPTY |
| `ff7e4d21-4fa0-5fb9-8bc0-90c2112b0445` | `5971704` / 2 | epoch 33，同一个来源版本 | SUCCEEDED / VERIFIED_EMPTY |
| `3e43a9a4-5458-56f7-8726-0c0ae22e8568` | `5971705` / 1 | epoch 33，同一个来源版本 | SUCCEEDED / VERIFIED_EMPTY |

京东来源经正常 UI 停止读取后，Plan 再次 WAITING_RESOURCE；重新允许读取使 sourceVersion 改变，原 Plan 自动取得第二窗口。随后使用首条真实 Task 的原 holder 上下文，通过设备既有硬件签名和部署中的标准协议重放 heartbeat、fail、complete，各返回 **409 STALE_PLAN_NOTIFICATION_AUTHORITY**。

另一次独立探针保持 sourceVersion 不变，撤销应用内用户 grant，runtimeTarget epoch 从 29 变为 31。第二条真实 Task 的原 holder 对同三个入口也全部返回 **409 STALE_PLAN_NOTIFICATION_AUTHORITY**。恢复 grant 后 epoch=33，既有 Worker 自动建立同窗口 attempt2；下一自然窗口再次完成原生读取。旧成功 Task、Result 与 Ledger 不改写，没有另建 Plan、PlanVersion 或重复用户确认。

两个拒绝探针均保留请求摘要、明确响应及前后权威快照；holder 来自实际已完成的 SUCCEEDED 读取，**不是执行中 process death 的证据**。来源始终为原手机京东连接，没有模拟 Result、直接改数据库或增加生产探针入口。

API、ExecutionWorker、OutboxWorker r3 部署后健康端点均 200。状态修复 r5 APK 已安装，SHA256 `0DBD0F31BE09C7E80C9F2012F418B1C1320C942F0FDDA94B99A6738394EA17FA`。首次页面显示“等待新物流线索”，并说明当前范围不能证明没有快递；仅修正当前情况/下一步文本，没有布局扩展。随后安装后快照的真实当前状态是 WAITING_RESOURCE / health UNKNOWN，历史空读 WAIT 仍保留，不能拿旧 checkpoint 冒充当前可读取。此快照的四条 Task/Invocation/Acquisition 完全保持，当前没有物流 Receipt、Truth、异常 Execution 或站内异常提醒。

| 连续证据 | 用途 |
| --- | --- |
| [初始缺口](../../artifacts/v83-p3-plan-active-denied-real.json) / [首次真实读取](../../artifacts/v83-p3-plan-after-user-access-real.json) | 原 Plan/v1 从授权不足自动恢复至 VERIFIED_EMPTY/WAIT |
| [来源撤销](../../artifacts/v83-p3-plan-source-revoked-real.json) / [来源恢复](../../artifacts/v83-p3-plan-source-restored-r2-real.json) | sourceVersion 变化与后续窗口 |
| [来源版本拒绝](../../artifacts/v83-p3-source-fence-probe-real.json) / [拒绝后](../../artifacts/v83-p3-plan-after-stale-probe-real.json) | 三入口各 409；旧成功读取证据保留 |
| [epoch 撤销](../../artifacts/v83-p3-plan-epoch-revoked-real.json) / [epoch 拒绝](../../artifacts/v83-p3-epoch-fence-probe-real.json) / [拒绝后](../../artifacts/v83-p3-plan-after-epoch-probe-real.json) | 相同 sourceVersion，epoch 独立变化与 fencing |
| [恢复与三个窗口](../../artifacts/v83-p3-plan-epoch-restored-real.json) / [安装后](../../artifacts/v83-p3-plan-installed-final-real.json) | epoch33、自动 attempt2、新窗口，模型/确认/历史身份保留 |
| [证据复核](../../artifacts/v83-p3-plan-acceptance-final-reviewed.json) | 只读对比，不将空读/合同测试写成正向 Truth 真验 |
| [部署](../../artifacts/v83-p3-closure-runtime-deployment-r3.json) / [健康](../../artifacts/v83-p3-closure-runtime-ready-r3-verified.json) / [APK安装](../../artifacts/v83-p3-closure-apk-install-r5-real.json) / [真机状态](../../artifacts/v83-p0-p3-plan-installed-status.png) | 已部署、已安装、实际页面状态 |

API/Mobile typecheck、API/Android 构建通过；控制投影另有 7/7、既有 native Truth 兼容 23/23 回归。构建、隔离回归、真实空读和正向业务事实分别记账。仍需真实物流通知完成 Candidate → 用户核实 → Truth、含 Truth 的最终发布一致性，以及 Plan 的真实 Truth → Assessment → 提醒 → post-result WAIT；**P3 仍 IN_PROGRESS**。

离线证据复核最终 **57/57 PASS**，15 个输入文件 hash 与观测区间内的读取身份核对完成，原临时 Goal/失败 Task/最终答案不变。首版 42/46 与首次严格 provenance 检查 55/57 失败记录均保留；修正仅归一化 ISO/epoch-ms 时间表示、补充既有不可变 Invocation 的后续 Acquisition 引用证据，并明确中间 `ff7e4d21` 没有自身 WAIT audit，最终 WAIT 归属下一窗口 `3e43a9a4`。不得将此复核推导为未来无限期没有重放，或正向物流事实已通过。

### 中断后的运行恢复与最终当前状态（2026-10-09）

后续恢复检查发现 API/两个 Worker 进程已停止，且手机本机会话失效；手机 ADB 仍连接。恢复同一已授权部署为 r4 后，三个 health/ready 检查均 200。原用户经正常手机验证码登录恢复，未向手机注入 Token；没有新建用户、Plan、PlanVersion 或生产业务记录。

通知 listener 加入 Android 标准 `requestRebind` 的最小恢复尝试：只在 SDK≥24、系统使用权/当前账号 grant/采集开关均已开启且尚未连接时触发，单调时间节流为 30 秒。请求本身不设 connected/HEALTHY；只认真实 `onListenerConnected` 回调。canonical 与 generated Kotlin 副本局部修改保持一致，Android 构建通过，r6 APK 已安装，SHA256 `3D053C9A6DEA20716953DCD09754718BF5DC200C9D86BCE9DC89D3C4186C437C`。

本机 logout 的既有隔离规则会清空本地通知来源名单；服务端京东授权仍保留，不能把服务端 ON 当作本地可读取。通过正常系统监听连接和京东来源 UI 恢复后，本机状态实际为 grant=1、permission=GRANTED、health=HEALTHY。当前窗口 `source-watch:5971716` 中：

- `cbbfefc4-6193-52e1-8056-93b9918ad065` attempt1 始终 FAILED / `STALE_PLAN_NOTIFICATION_AUTHORITY`，绑定旧 sourceVersion；没有将其改成成功。
- `76208d59-1a9f-571f-833f-4aadc93c3ef8` attempt2 自动绑定当前 sourceVersion `2026-10-09T03:03:15.159Z` / epoch33，真实结果 SUCCEEDED / VERIFIED_EMPTY，Invocation Ledger VERIFIED。
- 11:03:22（Asia/Shanghai）同一原 Plan/v1 记录该 attempt2 的 WAITING_FACT_CHANGE / WAIT。前四条已完成读取及冻结合同保留；Receipts/Truth/异常 Execution/提醒仍为0。

当前页面再次实际显示“等待新物流线索”，并说明授权读取范围不能证明没有快递。此恢复仍使用既有 Worker/Resolver 的受控只读 attempt，没有手工补 Task/Result。**本轮还通过正常系统权限 UI 恢复了监听连接，不能独立宣称此手机仅靠 requestRebind 即已自动恢复**；该修复目前是 BUILD_VERIFIED / DEPLOYED，现实健康回调与后续 Plan 恢复则有真实证据。

最新证据：[r4部署](../../artifacts/v83-p3-closure-runtime-deployment-r4.json)、[健康200](../../artifacts/v83-p3-closure-runtime-ready-r4-verified.json)、[r6安装](../../artifacts/v83-p3-closure-apk-install-r6-real.json)、[当前只读快照](../../artifacts/v83-p3-plan-r6-current-real.json)、[最终页面](../../artifacts/v83-p0-p3-r6-plan-final-status.png)、[恢复补充复核](../../artifacts/v83-p3-plan-r6-recovery-reviewed.json)。旧57项复核与r5等待资源记录保持，不覆盖历史事实。P3仍IN_PROGRESS，正向物流Truth的三个既定待验项不变。

补充复核 **28/28 PASS**。当前快照为6条Task（5成功、1旧来源失败）、6条Invocation与5条Acquisition，不能把失败Invocation称为已有成功Ledger。新成功Result的Delivery/ACK在该快照尚未观测，不将Ledger已持久化推导为ACK已完成；此限制不改写既有P1/P2关闭证据，也不新增P3故障场景。

下一步首先等待真实京东物流通知，经合法查询/本机受控读取 → Shipment Candidate → 核实 → Truth → 对应原查询结果。本次查询已按冻结范围完成；此后新到的通知不能追加进已完成Task或改写本次空读证据。不得为了验收制造通知、直接插生产 Receipt/Truth，或把空读改成物流成功。

### 11:51 真实业务验收准备检查（2026-10-09，Asia/Shanghai）

API 与两个 Worker 的 health/ready 实际均为 200，ADB `2c696fe` 已连接。检查发现开发手机的 API reverse 转发已丢失；恢复既有 `tcp:3001` 转发并通过正常来源页面刷新后，当前 Target 为 ONLINE/HEALTHY，通知 grant=1、系统权限 GRANTED、epoch=33。京东本地来源已允许读取，但页面明确显示没有待同步通知线索。

原 Plan/v1 与 definition hash 不变；既有 Worker 在新的自然窗口 `source-watch:5971725`、`source-watch:5971726` 产生受控只读 attempt，各为 SUCCEEDED。11:50:15 原 Plan 记录 VERIFIED_EMPTY → WAITING_FACT_CHANGE / WAIT。没有手工补 Task、重新提问或确认，也没有改写旧空读结果。快照中累计10条历史Task，Receipt/Candidate/Truth/异常Execution/提醒仍为0；新增自然窗口不是新增 fault case 或正向业务验收。

证据：[连接前快照](../../artifacts/v83-p3-truth-preflight-20261009T034920543Z-real.json)、[连接后快照](../../artifacts/v83-p3-truth-connected-20261009T035119052Z-real.json)、[正常来源页面](../../artifacts/v83-p0-p3-truth-preflight-20261009T115057-sources.png)、[有界历史复核](../../artifacts/v83-p3-truth-readiness-recovery-final-reviewed-20261009T035119Z.json)。复核确认原Plan/v1、旧Task、Invocation身份与已有Ledger结果保持，未产生新的模型或确认记录。初次复核因误用Task类型名NOTIFICATION_READ失败，实际合同类型为NATIVE_NOTIFICATION_READ；失败记录保留，修正只涉及复核预期，未改Runtime或原证据。

本次仅恢复验收连接并确认当前准备状态，不新增关闭条件，不作为纯自动requestRebind证明。最后三项仍REAL_PENDING，P3保持IN_PROGRESS，等待真实京东物流通知及满足冻结异常规则的已核实Truth。

### 16:29 继续检查与现有监听连接恢复（2026-10-09，Asia/Shanghai）

本次继续时API/两个Worker的health/ready均200，手机ADB已连接，但开发API转发丢失。恢复转发后，当前系统权限和本机grant均已授权，京东来源仍为唯一允许读取的应用；实际监听健康为UNKNOWN，原Plan在WAITING_RESOURCE，不用旧11:51的WAIT冒充此时资源可用。

通过正常系统通知使用权设置重新连接后，本机状态页面实际显示“可用/健康正常”，服务端Target为ONLINE/HEALTHY、epoch33。系统页面在最终确认脚本运行时发生变化，脚本因未观测到预期按钮中止；恢复结论以当前本机状态、签名能力投影和后续真实读取为依据，不归因于脚本独自完成系统确认，也不宣称纯自动requestRebind已验。

原Plan/v1、definition hash、模型与确认身份不变。既有Worker自动产生Task `99c9d866-c7d7-5327-80ce-a549ee4595e2`，16:28:09真实SUCCEEDED，16:28:10记录VERIFIED_EMPTY → WAITING_FACT_CHANGE / WAIT。16:29快照累计12条历史Task，京东Receipt/Candidate/Truth/异常提醒仍为0，正常来源页没有待同步线索。只读对比确认本次连接前的旧Task、Invocation身份及已有Ledger结果保持；未手工补Task、注入Result、确认不存在的事实或新增fault case。

证据：[连接前快照](../../artifacts/v83-p3-truth-check-20261009T082257714Z-real.json)、[恢复后快照](../../artifacts/v83-p3-truth-check-restored-20261009T082921343Z-real.json)、[有界历史核对](../../artifacts/v83-p3-truth-check-restored-20261009T082921343Z-summary.json)、[本机健康](../../artifacts/v83-p0-p3-truth-check-20261009T162811-post-settings-gates.png)、[当前来源页](../../artifacts/v83-p0-p3-truth-check-20261009T162916-current-sources.png)。此次仅恢复当前验收条件，P3三个真实Truth闭环仍REAL_PENDING，P4/P5/P6未开始开发。

已证明 TEMPORARY Goal 与 Persistent Plan 的原来源受控恢复；长期链当前仅为真实空读/等待，没有正向物流 Truth。SMS、Provider OAuth、MCP、Windows 或 Service 的 ResourceGap 通路未验收。

source epoch/sourceVersion 变化的旧真实 holder 请求拒绝、同来源重新授权后的自动恢复已真实验证；未完成 Task 在换绑时的全面中断、实际跨设备 rebind 未由本轮探针证明。当前 sourceVersion 使用 app.updatedAt；正常 discovery 更新也可能使旧冻结版本失效。app.lastSeenAt 可被心跳更新，不等于重新取得安装/launchable 证明；Resolver 的在线判定以最近 heartbeat 为基础，未覆盖显式 offlineState 的全部语义。这些限制不能由本次成功空读推导为已关闭。

含 Truth 的结果分支还需验证：读取已核实事实后、最终发布事务前发生并发撤回/版本改变时，结果应保持事实权威一致。本次空读不含 Truth，未验证此边界。已有 owner/Goal/claim/source fencing 和回归不能替代真实业务事实证据。

本批 API/Android 构建、Mobile 类型检查与冻结协议回归均通过；未宣称本轮 GitHub CI Green、后台 Android OS Push 可靠送达或 P3 CLOSED。
