# V87-COMPUTER-05 · 受控 Browser Runtime

目标：补公开网站 Open→Observe→Fill/Click/Submit→Read-back 与结果未知时的只读核对，继续使用原 Plan/Risk/Approval/Outbox/Verification。

Backend：新增 controlled_browser ProviderAdapter，BROWSER_OBSERVE 为 R1，BROWSER_SUBMIT_FORM 为原 publish R3。无直接提交 HTTP 入口；原 ProviderRuntimeService 校验本人 Connection、grant、健康、冻结 Operation/input 和原审批，提交前再次检查当前权限/审批。新 browser 合同必须绑定独立能力、Connection 和 exclusive private publish；不能混入 Calendar/Handoff 或降低原风险。

Frontend：资源→接口中的“受控网页”显示实际服务是否已接入；未配置保持缺口，已接入才允许添加网站。连接与两项权限沿原资源详情管理，执行仍由原计划与逐次审批处理。没有自动生成网站 selector，也没有声称任意网站或账号已适配。

Database：零新表。Connection/Credential/ProviderManifest/Health/Grant、PlanVersion/ActionIntent、SideEffectOperation/Outbox/Verification/Reconciliation 仍是原权威。本轮仅隔离库发布测试 Provider revision；不发布生产目录或改变历史终态。

Runtime：playwright-core 使用管理员配置的现有 Chromium 可执行文件，不自动安装浏览器。每次操作新建独立 BrowserContext，不附着个人 Chrome、Cookie、CDP 或账号。仅管理员允许的公开 HTTPS origin 和本人保存的网站；DNS 有限时、拒绝私网并固定解析结果，禁代理/QUIC/非代理 WebRTC UDP。页面资源同 origin，服务 Worker/WebSocket/下载/弹窗隔离；读取和 lookup 仅 GET/HEAD。

表单：仅精确 ID、上限八个非密码字段和一个独立 operation marker。核对同一表单、POST、固定 action、无额外成功控件/隐藏输入及相同 origin；网络门只允许一次精确 URL/字段集合/值的主页面 POST。需要真实 POST 响应与对应 operation marker 的 DOM read-back，普通旧成功文本不证明本次操作。丢失响应保持 UNKNOWN，后续只读固定 lookupUrl，不再次提交。网页文本仍是来源证据，不直接写 Truth。

首次故障回归真实发现 Chromium 在连接断开后自动重发同一 POST；原失败日志保留。修复为消耗冻结的 dispatch 后，由固定 DNS/TLS 的无自动重试单次 transport 发出 POST，并把响应交回浏览器渲染；浏览器导航重试无法再次发送 mutation。失去响应/超时仍由原 UNKNOWN/只读核对收口，未放宽一次副作用断言。

配置：BROWSER_RUNTIME_ENABLED 默认 0；开启必须提供 BROWSER_EXECUTABLE_PATH 和 BROWSER_ALLOWED_ORIGINS（逗号分隔的精确 HTTPS origin）。本人权限、审批、允许网站范围与原运行门继续必需。默认未配置状态不显示为可执行资源。allowLoopbackTest 仅隔离测试并同时要求 NODE_ENV=test，生产 Service 不传此选项。

Test：实际启动本机无头 Chromium 访问隔离 TCP 网站，验证精确观察/密码节点拒绝、范围拒绝、原 Host 拒绝伪造执行、撤权前零提交、原审批/Outbox 一次提交、响应丢失与 GET-only 核对。测试网站与模型 fixtures 不是真实用户网站验收；先前失败日志、测试期间机器长时间暂停导致的超时/Token 过期记录保留。

夹具收口：实际 Chromium 启动与表单观察会超过默认 2 秒测试审批时效，专项采用现有 TEST_APPROVAL_TTL_MS=120000 并在结束后还原。两个表单场景分别通过原 API 创建 Connection，避免共用每分钟连接预算；每次联合测试使用新的隔离 Redis prefix。生产审批时效、Provider 限流、UNKNOWN 与一次副作用断言均未放宽。

完成状态：实现与自动化结果见 V90 联合记录。生产 Browser 仍默认关闭；真实网站验证、Android Input/Screenshot/OCR/Vision 的完整组合和本人真机 Observe/Act/Verify 仍不宣称完成。V87 overall IN_PROGRESS。

下一任务：本人正常手机入口与真实 App Observe 证据仍按前序要求收集；Browser 需选择实际网站、核对允许范围、本人权限/审批与具体表单/只读 lookup 的实际契约，再做现实验收。不能用隔离网站关闭 V87。
