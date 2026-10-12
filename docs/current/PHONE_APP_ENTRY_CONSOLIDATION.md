# 手机应用入口收拢

2026-10-12：用户指出添加手机应用的入口重复。原资源页加号、应用能力页加号、侧栏添加来源和旧连接页指向不同路由；原应用能力列表点击未接入应用会再次要求从完整列表选择。

主入口统一为「资源 → 本机 → 手机应用」。本机页移除重复添加加号；应用目录同时提供搜索、刷新、接入状态、已接入应用的能力详情及未接入应用的确认面板。选择未接入应用后直接保留所选对象，无需二次选择。目录核对当前账号及当前设备的连接；连接或设备查询失败时提供重试并禁止接入，避免把未知状态或其它设备连接当作本机未接入。

真实目录组件集中在 `apps/mobile/src/phone-app-catalog.tsx`，`/phone-apps` 是唯一目录路由。`/add-phone-app` 和 `/connections/add` 保留为兼容重定向。侧栏及领域页的泛来源入口改为管理资源，步骤缺资源也进入资源页；可信设备空态和本机管理直接跳到同一手机应用目录。云资源、接口和其它设备配对仍沿原分类入口。

添加仍由用户亲自点击原确认按钮，沿原设备签名和连接 API；添加成功进入该应用的原能力详情。没有代替用户确认、自动接入或扩大读取与执行权限，不涉及 Runtime 或数据库迁移。

自动验证：Mobile 最终类型检查通过；原应用接入合同、资源分类、应用发现配置联合 29/29。第一次类型检查发现兼容重定向的生成路由类型缺项，按项目现有路由处理修正；失败日志保留。构建和真机结果以本记录的后续验收段为准。

私有日志：`artifacts/phone-app-entry-typecheck-r2.log`、`artifacts/phone-app-entry-regression-r1.log`。

最终包随V93规划交接r2保留数据安装；实际APK与内嵌Hermes hash均与构建一致，原tracked bundle及12个独立文件保留。正常手机已见单一「手机应用」标题、刷新、138个应用；未接入的AIDA64直接打开该应用的原确认面板，随后关闭，未代确认添加。两个旧路由分别实测返回同一目录。资源本机页移除加号及保留手机应用行已截图核对，云资源入口仍保留。

私有截图：`artifacts/v91-device-app-entry-resource-r1.png`、`artifacts/v91-device-app-entry-local-row-r1.png`、`artifacts/v91-device-app-entry-legacy-final-r2.png`、`artifacts/v91-device-app-entry-final-preview-r2.png`、`artifacts/v91-device-app-entry-legacy-connection-r2.png`。最终安装证据`artifacts/v93-handoff-install-r2.json`。Clipboard占用及手机IME改写英文输入的失败验收日志保留，未计作成功搜索/已接入行旅程；已接入行直达详情的真机点击尚待补验。未提交、推送或生产发布。

2026-10-12 补验：最新包在手机键盘切到英文输入后，精确 `com.tencent.mm` 与 `calculator` 各筛出对应应用；已接入计算器直接进入原能力详情，没有再次出现接入确认。输入法改写失败记录保留，最终有效输入按XML核对。当前目录135条，与系统Launcher去重并排除本App后的135条相同；此前138是当时的系统目录数量，不是固定上限。证据：`artifacts/v93-report-phone-entry-acceptance-r1.json` 与 `v91-device-v93-app-filter-r2`、`v91-device-v93-app-calculator-r1`、`v91-device-v93-app-connected-detail-r1`截图/XML。搜索和已接入直达的待验项已完成，不计组合报告或执行验收。
