# V88 持续运行的核实结论与历史

任务编号：V88-LOOP-03。

目标：让日程关注卡片和计划的每次运行记录显示可靠的核实结论，区分原执行状态、当前只读核对结果和仍未完成的步骤。

Backend：Loop 的最新状态和分页历史共用一个只读 Reflection 投影。正式 Case 必须为 RESOLVED，且 VerificationEvidence 与本人、原 Execution、Operation、ExecutionStep、Policy、ActionIntent 和结果状态一致。成功、部分成功、失败分别投影为 VERIFIED、PARTIAL、FAILED；缺证据、错配、尚未结束的 Case 或缺少 durable Result 不能消除 UNKNOWN。任何未核实步骤的 OUTCOME_UNKNOWN 继续优先展示。

Frontend：日程关注卡片显示部分完成；计划的“持续运行记录”逐次显示核实结论，并保留“原运行记录”。执行器成功但没有核实结果显示尚未核实，原执行失败但只读核对成功显示当前已核实；等待 checkpoint 和尚在执行的运行没有制造 Reflection。五个一级入口保持不变。

Database：零新 SQL、零生产迁移。批量读取当前分页中的 terminal Execution、Invocation/Result、Case、Step 和已提交证据；不为历史创建新 Task、权限、Ledger 或 Truth。verifiedResultCount 按 Invocation 身份去重，计入有正式结论的成功、部分成功及失败，不按重复证据条数计数。

Runtime：原 Execution/Task/Scheduler、审批、设备签名 dispatch 和 lookup-only Reconciliation 保留。全部 Invocation 已核实也必须检查其余步骤；有失败、跳过、取消或未开始步骤时不能把整体显示为完全成功。明确取消仍保持 CANCELLED；无匹配核实证据的未知结果禁止通过读取入口恢复或重发。

Test：最终 API 4 文件 48/48，Mobile 全套 66 文件 416/416，Plan-schema 全套 46 文件 252/252，八包 typecheck 与 API/Web/Android Hermes export 通过。API 使用既有 `lazy_armor_v88_v89_20261010_test`、MySQL 3311、独立 Redis 6391 database 15 和每轮唯一 prefix；没有访问个人 token 或向开发库写入测试 Plan/Memory。

新增专项覆盖三种已知核对结果、七种证据身份错配、缺少 durable Result、混合成功/失败、未开始步骤、另一未结 Case、取消和逐 Invocation 计数。原生签名链专项沿原 API 完成 UNKNOWN→lookup-only 核对→最新及历史 VERIFIED，并确认原 Execution 与 UNKNOWN Ledger 不变；缺匹配证据仍显示 UNKNOWN。以上使用隔离签名 collector，不是实际手机 Observe 或七天运行证明。

首轮 API 47/48，新增未完成步骤断言失败；原日志保留。补齐步骤投影后，固定最终源码重跑 48/48。Mobile 首组 35/35 包含原工作区设备 Runner 回归，已经包含在最终 416 项内，不重复累计。

本地运行：read-only schema preflight 通过，无待迁移，仅 0050/0051 的既有 LF/CRLF 差异。原三个 development 角色恢复，API 3001、Execution 3011、Outbox 3012 均实际 200/ready，手机 2c696fe 的 API reverse 已恢复。用户已告知真机登录，并经正常 UI 开启应用内许可和独立系统 observer；实际能力页显示可用/健康正常。已有十二个登录/设备 Runner 文件 SHA256 不变；构建包含当前工作区字节，没有修改或吸收到本轮实现。

本机证据：`artifacts/v88-loop-r3-api-tests.log`、`v88-loop-r4-api-tests.log`、`v88-loop-r4-mobile-tests.log`、`v88-loop-r4-schema-tests.log`、`v88-loop-r3-typecheck.log`、`v88-loop-r4-api-build.log`、`v88-loop-r4-web-build.log`、`v88-loop-r4-android-build.log`、`v88-loop-r4-local-schema.json`、`v88-loop-r4-local-services.json`、`v88-loop-r4-local-readiness-restored.json`、`v88-loop-r4-client-config.json`。

APK：实际 JS resolver 配置 guard 通过，原 hermesc 编译该已核对输入；debug APK 构建成功并保留数据覆盖安装。源码 HBC、APK 内 bundle 与已安装 APK 字节核对一致，原 Runtime verifier 保留。APK SHA256 `d03e1e48c5a42e3c360d50f8b7dfd510c426fafaa438e906b7a2088b9ce16b75`；原已安装包和 tracked generated bundle 均备份，generated source 原字节已恢复。证据 `artifacts/v88-loop-r4-apk-installed-verified.json`、`v88-loop-r4-apk-build.log`。

真机前检另修正了 readiness 原正则误匹配不存在的 ReadOnlyPageObserverService 的问题；按 Android Manifest 实际 ReadOnlyPageObserver 严格核对 package/class，接受系统完整/简写形式，拒绝相似类名、其它包和禁用状态。工具 7/7，`v88-loop-r5-authorized-readiness.json` 已确认真实系统 observer enabled；工具仍不推断本人登录或 App consent，不发布 Beta 完成结论。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED / LOCAL_DEPLOYED / APK_INSTALLED。V88/V90 整体 IN_PROGRESS；真实页面观察、本人核实、实际第三方/资源闭环和七天持续运行仍需独立证据。

历史 0083 的 DESTRUCTIVE_MIGRATION_EVIDENCE_REQUIRED 门仍失败，不放宽或重写历史迁移。repository:hygiene、data:truth、terminology:check 通过；本轮不是 production/Beta 发布。

下一任务：继续原 V90-BETA-02 正常手机五页与受控 Observe→候选→本人核实→原会话结果。页面读取仅在本人系统授权、应用内独立许可和单次范围确认齐备后执行；等待期间不制造授权、个人 Memory 或七天运行证据。
