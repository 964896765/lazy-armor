# V87 Computer Runtime · 受控页面观察边界

任务编号：V87-COMPUTER-01。

目标：在接入真正 Android 页面观察器之前，沿既有 APP_STRUCTURED_READ 路径确保每个读取只包含本次要求的字段，且失效、切换或过期的原读取会话不能产生新 Truth。

背景：V86-RESOURCE-02 已本地保存 fda37c0，资源需求核对、公开只读接口与来源 fencing 已实现/自动验证/部署/安装。本人的正常登录与真实 Goal 调用仍独立待验，不阻塞本轮合同与产品工作。本轮不回到 Calendar/P3，不引入第二套 Task/Invocation/Truth。

Backend：androidRead 在入队前校验 requestedFields 属于 Profile、非敏感、无 wildcard、无重复且有数量上限。ingestDeviceResult 严格核对 task owner、原 package/resource/session/device、READING 状态、未过期状态、foreground heartbeat 和 observedAt 时间边界；节点不能超出 requestedFields 或包含敏感字段。原 App 来源启用/设备/包名也重新核对。原会话、可信设备和 App 来源在原 DeviceTask completion transaction 内加锁，提交前再次核对，原 Task lease/CAS/fencing 保留。SourceInvalidError 逃逸原 completion transaction 并回滚其中全部新 Observation/Truth，保留原 claim，由原 runner 失败/租约恢复路径收口；原历史和既有成功 Truth 不被回滚或覆盖。

接口变化：现有 DeviceTask evidence 投影增加 readScope，仅包含原请求中有效的字段与 foregroundOnly/boundedSession。不是新许可，也不输出屏幕内容、token、claimToken 或个人账号。

Frontend：现有手机任务详情展示“读取范围”和用户可理解的字段名称，不暴露 selectors/session/epoch。可见返回在直达时回到资源。Mobile executor 仅处理已领取且未过期的 Task，核对原 appReadSessionId，向 native capture 只传本次 requestedFields，并过滤未要求或敏感节点；采集完成后重新核对会话、前台与有效期，再返回数据。改换会话不能复用旧采集结果。

Database：无新表、无新迁移、无新 Authority。使用原 DeviceTask、AppReadSession、TrustedDevice、ReadEvidence、Observation、Candidate、Truth。历史终态不改写。

Runtime：不新增执行器。复用既有 DeviceTask runner、signed device completion、lease、StructuredRead/Reality Pipeline。当前 native UI-node provider 仍未接入，真实读取继续 fail closed；截图/OCR/Vision/Accessibility/Input/Browser 不能因本轮 guard 或测试通过而标为可用。现有通知/分享会话不应在后续成为隐式页面授权；新增真正观察器前必须建立独立明确的页面读取 consent/mode、App 来源范围与 native 授权/健康门。

Tests：使用已有隔离 fixture Profile，非新增 mock source 或生产 Truth。覆盖只传/只返回请求字段、未领取/过期 Task、错误或采集中切换的会话、服务端停止/切换/超时来源、未请求字段与失效 heartbeat；零越权 Observation，原成功 Truth 保留。既有 file/provider/vision contract 和 Task 回归同时检查。真实 DB 套件的显式 opt-in 只使用隔离 3311 schema，不连接真实 Feishu 账号；fixture/模拟数字不作为真机证明。

Acceptance：合同与产品范围自动验证；本人合法 UI 在正常登录后显示读取范围。真正关闭 V87 仍要求真实设备/App/Web 的 Observe→受控 Act→read-back Verification 连续证据，当前不满足，不提前 CLOSED。

完成状态：V87-COMPUTER-01 IMPLEMENTED / AUTOMATION_VERIFIED / DEPLOYED / APK_INSTALLED；V87 overall IN_PROGRESS，native observer/本人入口仍待接入与真机。

下一任务：V87-COMPUTER-02 明确页面读取 consent/mode + 一个真实 native read-only observer，保留原 App/设备/账号范围、停止/切换/撤权门，先形成 Observation，不开放无审批点击或把字段识别直接宣称事实。

## 本地证据记录

首轮 Mobile 37 PASS / 1 FAIL：旧 fixture Runner mock 缺 heartbeatDevice，新 scope 验证未放宽；补齐 mock 后完整 4 文件 38/38 通过。首轮 API 32 PASS / 8 SKIP，真实 DB 套件默认未启用，不以 skip 记作通过；最终启用隔离 DB opt-in 后再收完整结果。

本机证据：artifacts/v87-controlled-observation-tests-r1.log、v87-controlled-observation-tests-final-r2.log。本人 UI / 真实页面读取 / 真实 Runtime 闭环仍 REAL_PENDING，不推送 GitHub。

实际问题修复：R6 套件从 StructuredReadService 入口加载模块时暴露 FactDemandResolver/DeviceTasks 的依赖循环；补 explicit forwardRef 注入，不改变 Resolver 逻辑。最终发布的 SourceInvalidError 必须回滚整个 completion transaction，不能由普通验证失败分支提交部分 Truth。r3 的剩余 1 个失败为旧测试要求重复 complete 拒绝，与当前 Frozen Result 幂等合同不符；修正为相同结果同 identity、不同结果拒绝。r4 完整 R6 集成 9/9 通过；App 来源禁用门补齐后执行最终全组。

最终 API 4 文件 41/41、Mobile 4 文件 38/38 通过；API/Mobile typecheck、API/Web/Android bundle/APK build、repository hygiene 与 terminology gate 通过。已更新本地三角色、覆盖安装保留数据并核对当前 bundle 与 APK/安装包字节相同。APK SHA256 d06fe5733dd4cd198955b77039158933229a8f8f85223872dd1b3772beb2a55a。

最终证据：artifacts/v87-controlled-observation-tests-final-r5.log、v87-controlled-observation-deployment-r1.json、v87-controlled-observation-readiness-r1.json、v87-controlled-observation-r1-install-real.json、v87-controlled-observation-apk-build-r1.log。

## 下一任务书 · V87-COMPUTER-02

目标：明确授权一个 App 的限时页面读取，接入真正只读 native observer，沿原 DeviceTask 将实际 Observation 交付后端。

背景/范围：沿已验证的字段、会话、源 App、设备、租约与原子回滚边界，先完成一个真实 App 的 Observe。截图/OCR/点击/输入/支付/提交分开登记与验收。

Backend：页面读取具有独立显式 consent/mode；通知/分享许可不隐式扩成页面许可。Planner/Goal 需求与原来源会话绑定，重新核对 required capability、source permission、sourceVersion/epoch 与 runtime health；冻结执行范围，拒绝客户端拼装可执行授权。Observer 只提交 Observation/候选，按原 Verification 处理。

Frontend：资源中的设备/App 能力入口显示系统权限、App 来源范围、运行健康及限时读取状态；明确开启/停止，提供可见返回。正常登录与系统权限由本人通过合法 UI 操作，未授权时显示缺口并保留原目标。

Database：优先使用原 Connection/LocalCapability/AppReadSession/Task/Observation/Verification 权威；若必须新增字段，先冻结 schema/migration/release evidence，不另建 Truth 或 Runtime 调度权威。

Runtime：native observer 仅在原账户、指定 App 前台、原会话、冻结 selectors 与有效 Task claim 内采集；停止、撤权、换前台、换来源、lease/epoch 失效后拒绝旧数据。复用 Shared Runtime/DeviceTask/交付恢复；原 Ledger 与历史结果不变。

Tests：真实 source consent + profile 字段边界、native 数据最小化、采集前后来源 fencing、跨账户隔离、重复 delivery 身份与既有 Task/Runtime 回归。原模拟 fixture 不作为 native observer 证明。

Acceptance：正常 UI 明确授权→原 Goal/Plan 的受控读取→真实 App 字段→Observation→Verification/Result；来源失效不能污染 Truth，结果回原对象。真人手机证据和隔离自动化分开；V87 关闭仍需真实 Observe/Act/Verify 全阶段验收。

状态：任务书已准备，尚未实现 native observer；主线保持 V87 IN_PROGRESS。

## V87-COMPUTER-02 · 2026-10-10 当前实现

目标：独立明确授权一个 App 的限时页面读取，接入只读 native observer，沿原 DeviceTask 保存 Observation/Candidate，并提供独立核实入口。

Backend：新增 UI_READ mode 与 ui-read.v1 consent，通知/分享会话不能使用页面能力。签名设备请求冻结 App、字段和 sourceVersion；许可证据保存在原 AppReadSessionEvent。原 Task 的 claim/heartbeat 签发 ui-observation.v1 ticket，绑定账户、session、字段、sourceVersion、claimToken/lease，并核对当前 grant/系统权限/health。复用原 native verifier 身份，Calendar ticket schema 保持独立。

接口：原 POST /app-read-sessions 在 UI_READ 时要求 uiReadConsent；原 APP_STRUCTURED_READ 返回签名 dispatchAuthorization。App 资源投影增加 page_read，requiresSessionConsent=true、executionAuthorized=false。新增 owner-scoped GET /candidates/:id；确认/拒绝沿原 RealityPipeline，并发确认锁住原候选，重复确认返回同一 Truth。

Frontend：资源→App→限时读取页面，显示系统权限、观察器健康、本机独立 grant 和字段范围。用户确认后通过原 structured-reads 取得受控 Task；客户端不直接制造执行授权。结果页显示“已采集，等待确认”，可核实/拒绝线索和查看事实依据。二级入口保留返回 fallback，读取期间的系统通知可返回应用或停止读取。五个一级页不变。

Database：无迁移。复用 LocalCapabilityState、DeviceAppConnection、AppReadSession/Event、DeviceTask、ReadEvidence、Observation、Candidate、Truth 与审计。grant revoke/regrant、权限或健康变化终止旧 UI 会话；sourceVersion 变化拒绝旧来源，旧 Task/Result 保留。

Runtime：ReadOnlyPageObserver 为按次 AccessibilityService。系统权限范围较广，仍需应用内独立许可和每次范围确认。仅原账户、原 App 前台、原 session、签名 ticket 和有效 lease 内读取精确 selector；禁止 wildcard、模糊匹配、密码/可编辑/敏感节点及整屏文本。遍历、深度、字段数和长度有上限，歧义节点拒绝。采集前后检查会话、权限、前台、账户及 App 包版本，保留实际 native observedAt。不提供 click/input/submit/截图。切到目标 App 时停止任务轮询，仅已经领取的签名按次读可完成交付。

Truth：字段格式通过只产生 Observation/Candidate，不自动确认业务事实。沿原 FAILED/NEEDS_CONFIRMATION 终态确认收到了证据，并对相同结果 replay 保留同身份，避免 runner 重读；独立用户核实不将历史 Task 改写成早先已验证的成功。

真实目标：23049RAD8C 已安装 com.miui.calculator；实际 APK 资源表核对 com.miui.calculator:id/result。资源表读取不等于页面采集验收。支付宝旧语义 Profile 未取得真实 view-ID 映射，不开放 native UI_READ；fixture Profile 仅在隔离测试准入，不作为生产来源。插件模板与已生成 Native 源码同步，保留原 Calendar/Artifact/Share 实现，防止 prebuild 覆盖既有能力。

Tests：API 8 文件 79/79，Mobile 6 文件 44/44，Shared 3 文件 11/11；覆盖独立 consent、源版本与 grant fencing、事务回滚、历史保留、精确 selector/整屏内容拒绝、ticket 签名、并发确认同 Truth、账号/会话切换、按次 handoff 与 shutdown、同身份 replay。API 数据仅在隔离 3311 schema/Redis 15；模拟节点不作为真机证明。Shared/API/Mobile 类型检查、API/Web/Android bundle/APK 构建已通过。

本机证据：artifacts/v87-page-observer-tests-final-r5.log、v87-page-observer-mobile-final-r1.log、v87-page-observer-api-build-r1.log、v87-page-observer-web-build-r1.log、v87-page-observer-bundle-final-r2.log、v87-page-observer-apk-final-r2.log。初轮失败保留，已修正 Shared export/build 顺序、候选交付语义与隔离 fixture 的 verified_by 字段使用错误，没有放宽来源门。

Acceptance / 完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED；本地部署与安装证据另附。本人正常登录、独立系统辅助功能授权、真实页面 Observation→候选核实仍 REAL_PENDING；不通过 ADB 开权限或替本人登录，V87 overall IN_PROGRESS。

下一任务：V87-COMPUTER-03 将明确页面事实需求接回原 Conversation/Goal 的资源建议与合法确认入口，复用本轮冻结范围与签名 Task。不先加入 click/input，不把资源页按次 inspection 冒充 Goal Runtime Golden Flow。

本地部署/安装：2026-10-10 已完成三角色 readiness 核对与 2c696fe 覆盖安装，保留应用数据。最终 APK SHA256 d5b0c81eb519f8c1f73d178795a0b4e660a8602de3e17a016efffb890578c420；源码 bundle、APK 内 bundle 与安装包字节均一致。证据 artifacts/v87-page-observer-deployment-r1.json、v87-page-observer-readiness-r1.json、v87-page-observer-r1-install-real.json、v87-page-observer-apk-final-r3.log。完成状态补充 DEPLOYED / APK_INSTALLED；真实页面读取及本人核实保持 REAL_PENDING。
