# V8.1 收口进展（2026-10-04）

本轮延续 `integration/2026-10-01-cleanup`。保留已有引擎、五页主结构、开发 OTP 和真实 AI；未建立并行执行、连接、任务或附件系统。

## 代码与合同

1. Automatic Plan Wakeup 复用 execution worker 的 TerminalHandoff：按 Trigger 的 cron/timezone 解析触发分钟，读取当前 active PlanVersion 的冻结来源合同，经 SourceResolver 派发既有 Native Calendar DeviceTask 或 Google Calendar Provider。DeviceTask 持久化触发来源，完成后可跨触发分钟恢复 Assessment。稳定任务键避免重复读取；空读取与失败读取均不据此发起执行。仅兼容既有 runtime schedule 合同且具有所需 Truth 时进入既有 schedule wakeup / Risk / Approval / Execution。
2. CreationDraft 显式来源冻结进入同一事务的 PlanCreationContract 与 PlanVersion；恢复草案、规则评估、运行评估均遵从 pin。来源撤销不自动换源。与 canonical Scenario 编译定义完全一致时复用原 StrategyRuntime binding；任意 AI 草案不伪造编译匹配。runtime 决策及重放重新验证来源；既有 ExecutionDispatch 也在实际执行前重验合同与所需 Truth，并锁定本机/设备授权，不能通过手动运行绕过冻结来源；TruthHandoffGuard 在执行事务内核对来源 provenance。
3. NextBestAction 接入现有 LifecycleRead：待审批、风险阻止、运行中、结果未知、验证缺失分别来自真实记录。Execution WorkItem 没有 Verification 成功证据不能 COMPLETE；已验证的一次运行不使循环 Plan 永久完成。缺合同/缺证据保持 UNKNOWN。
4. File/Share 使用既有 Artifact 与 Local Acquisition。新 `android-artifact-v1` 合同要求拥有的 Artifact ID、字节 hash、单次确认、成功读取、实际操作权限与签名设备请求。userGrant、系统权限、health 和 evidence 进入 Audit。ON_DEMAND 文件权限不被投影为全局 AVAILABLE。
5. Android 文件选择读取实际字节并比对服务器 Artifact hash。Android ACTION_SEND 文本分享产生短期、账号隔离的真实回执；外部引用保存时校验回执并走同一 Artifact/Acquisition。仅凭路由 SHARE 参数不能产生证据。当前新 Share 合同覆盖含具体链接的文本分享，未声称支持任意文件/图片分享。

## 真实真机证据

- 服务请求 `01a1073e-051a-777b-b896-0a0d31fc5621`：真机确认 PENDING → BOOKED → IN_PROGRESS → COMPLETED。实际服务是开发环境来源和投影诊断，交付报告已进入现有 Artifact。WorkItem 为 COMPLETED / COMPLETE，Schedule 含同一请求，3 次状态变更 Audit 均成功。验证性质为参与方确认，不冒充自动 Execution/Verification。
- 文件：手机系统 DocumentPicker 选择上述真实交付报告，Acquisition `01a10774-709d-700a-9ef0-52327ce61a1e` 为 VERIFIED_PRESENT，hash 与报告一致；Audit 包含 userGrant=true、systemPermission=ON_DEMAND、health=HEALTHY、单次 Artifact 同意，新增语义 Truth=0。
- 最新 APK 构建、安装及重启后服务“已完成”页面读取成功。APK 中 bundle 与 `artifacts/app-v81-closure-final.bundle` 已核对一致。

证据文件：`artifacts/v81-service-projection-evidence.json`、`artifacts/v81-service-audit-evidence.json`、`artifacts/v81-service-report-evidence.json`、`artifacts/v81-file-phone-evidence.json`；真机截图/XML 位于 `artifacts/android/v8-productization/v81-closure-*` 和 `v81-real-service-*`。

## 验收边界 / Pending

- 回归：6 个收口测试文件 41 项通过，4 个既有 ActionProposal/一次性执行/runtime/handoff 测试文件 10 项通过；共享 FactDemand/Assessment 测试 22 项通过。API/mobile 类型检查、API build、Android assembleDebug 均通过。隔离测试不是手机证据。

- 自动唤醒与来源冻结具有隔离数据库集成证据，包括真实业务代码的去重、冻结版本、签名 readback、空读取后恢复评估；这不等于非空日历 Golden Flow 的真机执行证据。
- 目前原生自动 Acquisition adapter 为 Calendar，Provider adapter 为既有 Google Calendar；其余能力不伪造实现。Provider 分页未完成时 UNKNOWN，读取失败为 UNAVAILABLE，不投影为空。
- 原生空日历既有真实 VERIFIED_EMPTY 保留；非空事件等待用户准备真实事项。
- 快递、账单、耗材：REAL_EVIDENCE_PENDING。工作邮箱：REAL_CREDENTIAL_PENDING。语音：PHONE_AUDIO_EVIDENCE_PENDING。
- 新 Share 回执链尚需真实外部 App 分享的手机证据，保持 PHONE_SHARE_EVIDENCE_PENDING。文件证据通过不替代此项。
- 用户 DeepSeek Key 的 HTTP 提交仍禁用。六条 Golden Flow 尚未全量验收；不得将本报告视为整个 V8.1 已全通过。
