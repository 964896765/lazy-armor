# Android 支持应用目录与真机验收

## 目的与边界

本目录为移动端的 **最小、可审查应用白名单**。系统仅向 Android PackageManager 查询目录中明确列出的包名；它不申请 `QUERY_ALL_PACKAGES`，不枚举设备上的其他应用，也不提供任意应用点击或自动化能力。当前每个已支持条目只实现用户主动触发的“打开应用”。

> **添加一个手机应用连接并不等于取得通知、内容、支付或下单权限。** 每项后续读取或操作都必须另行展示用途、取得授权、绑定允许范围，并验证结果。

| 应用 | Android application ID | 当前可用 | 后续状态 |
|---|---|---|---|
| 中国移动 | `com.greenpoint.android.mc10086.activity` | 用户主动打开应用 | 指定账单通知读取：未实现 |
| 微信 | `com.tencent.mm` | 用户主动打开应用 | 允许页面跳转：未实现 |
| 支付宝 | `com.eg.android.AlipayGphone` | 用户主动打开应用 | 页面跳转及支付协作：未实现；支付始终由用户完成 |
| 淘宝 | `com.taobao.taobao` | 用户主动打开应用 | 商品或订单页面跳转：未实现；不提供自动下单 |
| Gmail | `com.google.android.gm` | 用户主动打开应用 | 页面跳转：未实现；邮件读取使用独立 OAuth 连接 |
| Google 日历 | `com.google.android.calendar` | 用户主动打开应用 | 页面跳转：未实现；日历同步使用独立 OAuth 连接 |

Google Calendar、WeChat、Alipay 与 Taobao 的公开应用商店页面都将相应 application ID 置于其页面 URL 中，可作为首次目录录入的外部核验依据。[1] [2] [3] [4]

## 当前实现

Android 原生 `LazyArmorDeviceBridge` 执行两个受控操作。`detectSupportedApps` 仅接收白名单包名并返回该应用是否安装；`openSupportedApp` 仅接受白名单包名并通过系统启动 Intent 打开应用。服务端 `DeviceAppConnection` 仅记录用户、匿名安装标识、包名、展示名、启用状态、当前模式与最后见到时间，并为添加、停用或重新启用写入审计记录。

| 验收项 | 当前结论 | 所需证据 |
|---|---|---|
| 不枚举全部应用 | 已由静态 Manifest `<queries>` 与原生集合限制 | Android manifest 审查 + 真机日志（不得包含非白名单包名） |
| 添加、停用与恢复 | 已实现 API 与移动端页面 | 账号 A 添加/停用，账号 B 无法读取或更新其记录 |
| Rail 状态 | 已实现；仅显示服务端已启用的连接 | 真机添加后，重启 App 仍显示；停用后消失 |
| 用户主动打开应用 | 已实现原生调用 | 逐个目录应用真机安装/未安装测试 |
| 通知读取 | **未实现** | 后续须具备专用 Listener、用户系统授权、来源 allowlist、去重、解析、验证、审计与撤销测试 |
| 支付、转账、下单 | **未实现，且不允许自动执行** | 仅可在用户最终确认、结果可验证及 `OUTCOME_UNKNOWN` 不盲目重试的独立流程中评估 |

## 发布前真机步骤

首先必须使用包含原生 Bridge 的 Android Debug 或候选发布构建，而不是 Web 导出或 Expo Go。随后在每个目标设备上依次验证：已安装条目显示“已安装”；卸载后的条目显示“未安装”；未列入目录的应用永远不出现；添加后仅能看到“打开应用”；停用连接后应用从 Rail 移除；另一测试账号无法读取或修改该连接。真机编译、安装和这些记录均是本阶段的外部证据，不能由 TypeScript 或 Web 构建替代。

## References

[1]: https://play.google.com/store/apps/details?id=com.google.android.calendar "Google Calendar — Google Play"
[2]: https://play.google.com/store/apps/details?id=com.tencent.mm "WeChat — Google Play"
[3]: https://play.google.com/store/apps/details?id=com.eg.android.AlipayGphone "Alipay — Google Play"
[4]: https://play.google.com/store/apps/details?id=com.taobao.taobao "Taobao — Google Play"
