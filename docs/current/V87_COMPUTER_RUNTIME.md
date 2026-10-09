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
