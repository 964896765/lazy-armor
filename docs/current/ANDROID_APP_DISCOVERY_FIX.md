# Android 手机应用发现漏报修复

2026-10-12：用户指出手机“已发现应用”仅21个。ADB只读检查有139个不同的桌面启动应用包，包含懒人装甲；原App正常页面实见21个。上限是200，JS和Kotlin都没有21条限制。

原桥接调用`ACTION_MAIN + CATEGORY_LAUNCHER`，但主Manifest和Expo生成插件缺少对应`<queries><intent>`。Android 11+应用可见性过滤使原查询漏报。现已在两处补上同一桌面入口查询；保留原计算器、语音与HTTPS查询，没有新增QUERY_ALL_PACKAGES或内容读取权限。插件重复应用不会重复查询声明。

修正版保留数据安装后，手机原“应用能力”页实见138个，等于系统139个去掉本App。应用入口发现不表示消息/页面读取或执行授权，也不会自动创建连接。修复不涉及API、数据库或Runtime。

验证：生成配置/原生配置专项2/2、Mobile类型、Android/Hermes构建通过；实际安装APK hash与构建一致，原tracked bundle恢复，12个独立修改哈希不变。初次测试类型检查的Node/DOM URL不兼容已在测试中使用Node URL修正，失败日志保留。

私有证据：`artifacts/app-discovery-manifest-r2.log`、`artifacts/app-discovery-typecheck-r2.log`、`artifacts/v93-app-discovery-package-r1.json`、`artifacts/app-discovery-device-evidence-r1.json`及前后手机截图。未提交、推送或生产发布。
