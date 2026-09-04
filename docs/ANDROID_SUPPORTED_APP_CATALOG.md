# Android 应用发现与增强适配

## 产品边界

Android 端采用 **真实设备发现 → Generic App Connection → 可选 Enhanced Adapter**。用户在“添加连接”页主动发起发现时，应用只读取 Android 系统返回的可启动应用，并在用户明确选择后才保存该 App 的连接快照。未被用户选中的 App 不会写入服务端、不会进入 Rail，也不会被当作通知来源。

> **Catalog 不是应用连接白名单。** 任何当前设备真实发现、可启动且经用户确认的 App 都能成为 Generic App Connection；Catalog 只在匹配时补充可审查的专属适配信息，绝不决定一个 App 是否“允许连接”。

Android 11 及以上版本默认限制应用间包可见性；已安装应用列表属于敏感数据。系统应使用 `<queries>` 中最小化的启动器 Intent 需求，不使用 `QUERY_ALL_PACKAGES`，并且只在用户点击“添加连接”后执行发现。[1] [2]

## 当前实现

| 层级 | 当前行为 | 不会做的事 |
|---|---|---|
| Device Bridge | 调用 PackageManager 查询当前设备中可启动的应用，并返回真实 `packageName`、显示名称、版本、可启动状态和尺寸受限的图标数据 URI。 | 不预置某些品牌；不在服务端构造 App 名称或图标；不保存整机应用清单。 |
| Generic App Connection | 用户确认后记录当前 App 快照、设备安装标识、发现指纹、启用状态和已确认操作；当前支持用户主动“打开应用”。 | 不因未命中 Adapter 而拒绝创建；不自动读取内容、支付、下单或修改账户。 |
| Enhanced Adapter | 只有命中可选 `APP_INTEGRATION_CATALOG` 时才记录增强适配键。 | 不改变计划的品牌中立资源语义；不自动开启深链、读取或操作。 |
| 通知来源 | 用户需先在系统设置中授权通知访问，再为每个已添加 App 单独开启来源。端侧只暂存包名、时间、事件指纹、内容指纹及“是否有标题/正文”等最小线索。 | 不默认读取通知；不上传标题或正文；不以品牌名称作为通知逻辑分支。 |
| 服务端收据 | 只接受当前用户、当前连接、当前已授权 App 的最小事件；检查时间窗、限流、去重并写入审计与低基数指标。 | 不将未分类线索直接写成账单、订单或自动化输入；不触发付款、下单或其他自动操作。 |

## 真机验收

| 验收项目 | 通过条件 |
|---|---|
| 发现真实性 | 在候选 Android 构建中点击“添加连接”后，列表只显示本机实际存在的可启动 App；不存在示例或回退列表。 |
| 通用连接 | 选择一个不命中 Catalog 的真实 App 后，仍可创建、显示、停用/重新启用并由用户主动打开该 App。 |
| Adapter 可选性 | 命中 Adapter 与未命中 Adapter 的 App 均可完成 Generic Connection；两者差异仅为后续经审查的附加操作。 |
| 通知授权 | 未打开系统通知访问或未单独启用某 App 时，该 App 的事件不会收集、上传或进入消息中心。 |
| 最小化入站 | 端侧与服务端日志、收据、指标均不含通知标题、正文、用户 ID、完整应用清单或示例金额。 |
| 撤销 | 停止某 App 的通知来源后，端侧清除该 App 的待同步线索，服务端连接不再将其作为来源。 |

在真机构建、安装和双账号隔离测试完成前，真实发现、图标渲染、通知授权状态与后台回调均不得宣称已获得生产证据。Web、iOS 和 Expo Go 显示“无法读取设备应用/通知来源”是故意的安全降级，不应以 Fixture 替代。

## References

[1]: https://developer.android.com/training/package-visibility "Package visibility filtering on Android"
[2]: https://developer.android.com/training/package-visibility/declaring "Declare package visibility needs"
