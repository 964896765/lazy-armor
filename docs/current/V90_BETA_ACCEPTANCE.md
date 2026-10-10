# V90 Personal Life OS Beta · 联合验收记录

任务编号：V90-BETA-01（集成准备）；关联 V84-TASK-02、V87-COMPUTER-05、V88-LOOP-01/02、V89-SKILL-01/02。

目标：沿日程 | 计划 | 会话 | 资源 | 服务五页检查理解、个人信息、方法参考、任务、真实资源、验证和持续关注；缺少真实证据时不发布 Beta 完成结论。

Backend：Task 的取消/失败终态与正式核实证据投影、owner/version-scoped Loop/Reflection/History、版本化方法仓库和 GitHub/URL 导入均接回原 Planner/会话/计划确认。受控 Browser 通过原 Provider host 接入。计划来源、执行审批、Task/Invocation、Truth 与旧版本保持各自权威。

Frontend：日程显示持续关注，计划显示 Task 未开始终态、持续运行记录和冻结方法依据，会话继续原理解/资源确认/结果，资源增加受控网页入口，方法仓库支持文件与 URL 预览导入，服务继续真实发布与实际请求。方法导入不提供已发布服务或执行权限。五个一级页面的名称、顺序、数量不变。

Database：0090 仅新增四个 Skill 表，隔离 `lazy_armor_v88_v89_20261010_test` 已迁移；原数据和生产库没有本轮变更。

Runtime：保持原 Worker、排队/并发、租约恢复、审批、未知结果只读核对和 WAIT。Browser 默认关闭，明确配置的公开 HTTPS origin 才能运行；独立 Chromium 会话、精确表单合同和固定 DNS 的单次 POST transport 接回原 R3 审批/Outbox/Verification。响应丢失保持 UNKNOWN，随后 GET-only lookup，重放不重复提交。Android 点击/输入、本人授权、登录与确认事实没有由本轮代码自动开启。

Test：最终受影响 API 14 文件 137/137，覆盖 Task、Agent 理解/Context/确认、原 Goal 页面读取、原 Execution/多权威 Runtime、Verification/Reconciliation、Native Calendar、Browser、Loop、方法仓库/来源和原 Planner。Mobile 全套 63 文件 388/388，Plan-schema 全套 46 文件 250/250，Config 5 文件 63/63，八包 typecheck 通过。API/Web 构建及 Android Hermes export 通过。此前 Worker 真进程回归 6 通过、容器重启故障注入 2 项在 CI 模式跳过；重叠专项不累计成额外独立测试。

证据：本机 artifacts/v84-v89-resume-regression-final-r2.log、v84-v89-resume-mobile-final.log、v84-v89-resume-schema-final.log、v84-resume-config-tests-final.log、v84-resume-typecheck-checkpoint.log、v84-resume-api-build-checkpoint.log、v84-v89-resume-web-build-final.log、v84-resume-android-bundle-final.log、v88-v89-worker-regression-r3.log。Browser 实际启动本机无头 Chromium 与隔离 TCP 网站；这些模型/资源/网站 fixtures 不是真人/真机/第三方网站验收证据。

失败保留与修复：Browser 首次实际发现断开响应后 Chromium 会重发 POST，修复为固定 DNS 的单次 transport 后保持两次独立操作合计两条 POST。随后夹具默认 2 秒审批过期、共用 Connection 的限流预算和旧 Redis prefix 污染分别修正为现有测试时效配置、原 API 创建独立连接和每轮新隔离 prefix；生产审批/限流门未放宽。失败日志 v84-v89-resume-regression-r2.log、v84-v89-resume-regression-final.log 与 transport debug 记录保留，最终同组和原 Runtime 联合 137/137 通过。

更广 API 回归：首次全套运行触发旧 P0-H4 测试的共享 Redis 容器故障注入，已中止全套并恢复 Redis；API 3001、execution 3011、outbox 3012 均复核为 200。失败与中止日志保留，不能记为全 API 通过。安全复现发现测试手工队列未采用 REDIS_KEY_PREFIX，使重复投递、接管与移除操作落到另一队列；已修正夹具，原唯一 Execution、已成功步骤不重复、恢复审计断言保持。CI 模式隔离专项最终 6 通过、2 跳过；本轮没有重跑全套 API 或继续共享容器故障注入。

迁移门：全库 migration:safety 仍因历史 0083_runtime_authority_sources.sql 缺少 destructive release evidence 失败；保留原 baseline 与检查，没有豁免。0090 的新增表分段与独立测试库迁移通过，91 个迁移文件分段检查通过；hygiene、terminology、production-data-truth 和 diff 检查通过。用户已明确授权检查收口后提交并推送 codex/v83-persistent-runtime；生产迁移、当前三角色部署和 APK 安装没有在本检查点执行。

完成状态：本轮代码 IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED；V84～V90 总体验收仍 IN_PROGRESS，V90 未发布 Beta。进入本轮前的 12 个独立登录/设备 Runner 文件哈希不变，保留工作区且不纳入本轮提交。

下一任务与关闭证据：

| 阶段 | 仍需取得的现实证据 |
| --- | --- |
| V84/V85/V86 | 本人正常入口、记忆授权/删除/消费、真实目标调用能力并核实 |
| V87 | 独立系统许可、真实 App Observe→核实→原目标结果，以及受控 Act/read-back；Browser 已有受控实现，实际网站仍未验 |
| V88 | 原合法计划持续真实运行七天，观察/审批/结果/等待/恢复可追溯 |
| V89 | 实际第三方包由本人接入，真实模型与实际资源组合验证；当前只有隔离合同证明 |
| V90 | 上述真实闭环、迁移发布门及实际五页使用证据齐全后再关闭 |

本轮连续开发依用户最新指令推进独立代码；前序待验与阶段顺序没有被改写为 CLOSED，不要求用户回答“是否继续”。
