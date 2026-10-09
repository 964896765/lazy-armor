# V86 Goal Resource Match / Consumer Read Source

任务编号：V86-RESOURCE-02。

目标：将会话保存的能力需求接到资源核对入口，并保护既有公开 JSON 读取在授权和来源变化时不返回旧数据。

背景：接续 V86-RESOURCE-01。持续本地开发，不推送；不重开 P3，不绕过本人手机登录。会话中的 AI 建议、方案确认、资源就绪与执行授权继续分离。

Backend：新增 owner-only `GET /conversations/:id/messages/:messageId/resources?version=N`。只读取当前未归档会话、最新 assistant 理解消息及指定版本，计算结束再次核对原目标。输出 `goal-resource-match.v1` 派生投影，固定 `executionAuthorized=false`；不选择、绑定或创建执行资源。通知来源必须按具体 App 的既有 FactDemand Resolver 核对；这个只读入口关闭 RuntimeTarget refresh，Runtime 的默认刷新行为不变。

公开 JSON 登记为 R0 / read / BETA，沿用已有 Connection、Permission、Credential、CapabilityGrant、Health、Connector adapter。协议支持不证明 endpoint 内容真实，响应始终为 SOURCE_RESPONSE_ONLY，0 Truth/Invocation/Execution。Registry 和 Resolver 不放宽已有 PRODUCTION、purpose、resource、现实证据或审批要求，不新增 canonical alias。能力列表和 Resolver 共同检查必要配置的有效状态/有效期；凭据通过 owner Connection 的 credentialRefId 关联，不输出凭据内容。

ConsumerReadSource 在发请求前、adapter 返回后及最后发布前重新检查 capability、旧 permission、健康时效、配置身份/版本。快照包含日期的 ISO 值及 append-only 权限/断开/重授权/轮换 audit 次数，防止撤权后重新授权复用旧响应。拒绝旧响应不写成 provider 故障；请求仅接受已保存地址与空 input。原 HTTPS/DNS pinning/无 redirect/大小/时间限制保留。

Frontend：会话最新理解卡片提供“核对所需资源”；二级页列出能力、候选、缺口与现有资源管理入口，有可见返回及“返回原会话”。从资源页回来重新核对，不改写原理解。接口详情的读取按钮依据同一逐项 capability 投影启用；授权/检查/断开/账号或来源变化清除旧预览，错误或重新核对时不显示旧就绪结果。五个一级页面不变。

Database：无新表、无新迁移、无新的资源/执行权威；查询只产生派生结果。Registry 首次并发登记遇到 MySQL deadlock/duplicate 时最多重试三次，重新读取同一 immutable revision/hash；不同内容不得覆盖既有 revision。重试范围仅是可回滚的 metadata transaction，未扩展外部副作用重试。

Runtime：目标核对不是 Runtime 执行；手动接口读取是既有 consumer read inspection，不能记为新 Goal Shared Runtime Golden Flow。PLAN/USER_EVENT_SYNC 的 Resolver/Approval/Invocation/Verification/Truth 路径继续沿用；本轮不新增 executor。

Tests：隔离新 MySQL schema、Redis namespace、受控 adapter/理解 fixtures。覆盖 owner、当前消息/版本、目标计算中变更、只读无 Target refresh、来源恢复后同目标重算；读取前 stale health/expired credential 拒绝，读取中撤权、撤权重授权、配置轮换、断开后的旧响应拒绝；能力保持 BETA，响应不形成 Truth/执行权威，参数边界与原 SSRF 限制保留。并发三角色登记保留单一版本/证据，内容冲突继续拒绝。

Acceptance：正常登录→原会话理解卡片→核对所需资源→明确授权/检查→重新核对→按既有确认/Runtime 执行真实目标并验证。本人的会话核对和接口点击仍 REAL_PENDING；隔离 fixtures、构建与安装不代替这个闭环，V86 不提前 CLOSED。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / APK_INSTALLED；patched registry 已部署，API/Execution/Outbox 三角色 200/ready；开发库记忆/候选/关系/启用记忆用户仍均为 0。本地 checkpoint 不推送。

下一任务：V87-COMPUTER-01 受控页面观察的字段范围与来源会话 fencing；继承现有 DeviceTask、AppReadSession、ReadEvidence 和 Reality Pipeline，先确保观察不会扩范围或接收失效来源，再接真正 native provider。截图、OCR、Vision、点击/输入/提交不在此首任务中宣称可用。

## 验证与现场记录 · 2026-10-09

初批 API 8 文件 53/53、Mobile 6 文件 42/42 通过，两端 typecheck、Plan-schema/API/Web/Android bundle/APK build 通过。扩大受影响 provider 回归的 r2 为 95 PASS / 1 FAIL：新增并发测试的 manifest fixture 缺 accountTypes，被正式 validator 拒绝；修正 fixture 后仅重跑该完整文件，不放宽产品 validator。修正后的完整新合同文件 10/10 通过；最终 96 项独立断言均有通过记录，原 r2 失败日志保留。

本地首次并发部署发现首次 public_json manifest 注册的 ER_LOCK_DEADLOCK，Execution Worker 未启动。API/Outbox 已运行；恢复缺失 Worker 后三角色 ready，再补 bounded retry 与并发登记合同回归。初始 health 记录使用了错误的 Worker URL；正确探针为 API /api/health 和 Worker /ready，不能以错误 URL 的 404 判断角色健康。原失败现场/日志不覆盖。

APK 在 2c696fe 覆盖安装，源码 bundle、APK bundle 和已安装 APK 字节核对一致，SHA256：56ea6d9aefd0d593ef06e22a1d62e942d6ecabcff4fe27921651f73b078081a7。保留数据及正常登录；安装不记为本人 UI/真实 Goal 执行验收。

本机证据（不推送）：artifacts/v86-goal-resource-fresh-test-db-r1.json、v86-goal-resource-tests-r1.log、v86-goal-resource-tests-final-r2.log、v86-goal-resource-registry-final-r3.log、v86-goal-resource-deployment-r1.json、v86-goal-resource-worker-restoration-r1b.json、v86-goal-resource-readiness-r3.json、v86-goal-resource-r1-install-real.json。历史 0083 production migration evidence gate 继续未过，本轮无新 migration，不放宽历史 gate。

最终部署证据：artifacts/v86-goal-resource-deployment-r2.json、v86-goal-resource-readiness-final-r4.json、v86-goal-resource-development-authority-counts-r1.json。

真实网络补验：PUBLIC_JSON_REAL_READ opt-in 通过正常注册/显式授权的隔离账户，实际读取 https://registry.npmjs.org/typescript/latest，核对返回包名/版本及 SOURCE_RESPONSE_ONLY；0 Truth/Execution/Invocation。1/1 通过，证据 artifacts/v86-public-json-real-read-r2.log。最初 OpenLibrary 来源未通过连接检查（provider_error），r1 失败记录保留；未注入响应或放宽网络/时效门。这个补验是真实 HTTP Source inspection，不是本人手机或完整 Goal Shared Runtime Golden Flow。
