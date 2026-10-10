# V87-COMPUTER-04 真机读取续接

2026-10-10，OBSERVE_REAL_VERIFIED；V87 整体 IN_PROGRESS。

目标：同一正常登录会话读取手机计算器当前结果一次，通过原签名 DeviceTask、候选核实和原会话回显形成闭环。

Backend：保留原范围确认、签名 dispatch、候选与 Truth 权威；没有新增执行入口。原会话 `01a12561-d504-76db-b080-19af151d17e6` 的新消息复测，不重发首次失败任务。

Frontend：修复从 Android 设置返回同一范围页后权限状态不刷新的问题；AppState active 时重新读取 native 状态与应用内页面许可。Mobile 416/416 与 typecheck 通过，JS 配置 guard 与 Hermes/debug APK 构建通过。真机权限已由本人开启：应用内页面读取、Android observer、使用情况访问。

Database：无迁移、无 fixture 或直接 Truth 写入。只读 metadata 验证新候选状态为 PENDING，值为 `= 36,000,000,000`，字段 `com.miui.calculator:id/result`，readMethod `ANDROID_STRUCTURED`。

Runtime：首次任务 `9bef43d1-376c-557e-87a8-dbf1669c19a5` 为 FAILED / DEVICE_READ_UNAVAILABLE，保留历史。独立诊断确认 UIAutomator 注册期间会 suppress 正常辅助功能服务；活跃读取不再使用 hierarchy dump，不放宽 native guard。

复测任务 `6e100138-a553-5616-8abf-0e574d3e93aa` 沿新范围 `7f600eda-c388-5437-8c4d-472d98d11b1e` 实际打开计算器并读取，2026-10-10 19:12:26（Asia/Shanghai）形成候选 `01a12583-a381-766d-bf6e-ee4558689d63`。Task 原状态 FAILED / NEEDS_CONFIRMATION，不能写成 SUCCESS；候选 pending 不等于 Truth。计算器原内容未修改。

新 APK SHA256 `04b0c342459d91025f9838165d967da5928d7d4df7573a23b7715df2f44eb44c`，内嵌 HBC 与输入一致，保留数据覆盖安装成功。tracked generated bundle 原字节恢复；十二个独立登录/Runner 文件哈希不变。ADB 服务重启后恢复 reverse；本地三个角色再次恢复，实际 API health 与两个 worker ready 均正常。

Test：证据在本机 artifacts：`v87-ui-automation-observer-probe-r1.json`、`v87-real-resume-metadata-r2.json`、`v87-real-resume-screen-r10.png`、`v87-real-resume-package-r1.json`、`v87-real-resume-apk-build-r1.log`、`v87-real-resume-mobile-tests-r1.log`、`v87-real-resume-mobile-typecheck-r1.log`。metadata 的驱动 Date 序列化存在本地时区偏移，读取时刻以 value_json.observedAt 和 API UTC 日志为准，不使用该序列化值判定时序。

本人已在 App 核实候选并回复“已核实读取线索”。只读精确 lineage 核验候选 VERIFIED，Truth `01a12586-984f-71be-b8be-3ffd9c81108e` 为 verified / user_confirmation；当前版本 `01a12586-984f-71be-b8be-41830517ed65` 的值保持原 observedAt/readMethod，provenance candidate/observation 与来源一致，证据哈希一致。原 DeviceTask 继续 FAILED / NEEDS_CONFIRMATION，不改写历史终态。原会话实际显示“本次页面线索已核实”和 `= 36,000,000,000`。证据 `v87-real-lineage-r3.json`、`v87-real-resume-screen-r13.png`、`v87-real-resume-screen-r16.png`。

完成状态：真实 Observe → 候选 → 本人核实 → Truth → 原会话结果已验证。未提交、推送或发布；V87 Act/read-back、V88 七天、V89 第三方闭环、V90 联合验收与历史 0083 发布门继续独立待验。

下一任务：V87 受控 Act/read-back 的真实验收准备，并沿原审批和 Runtime 收取独立证据。
