# Android 可信设备与真实发现验收

本清单用于 Release Candidate 的**真实设备验收**。它不接受 Web、iOS、Expo Go、手工构造的 HTTP 请求、静态截图或 Fixture 作为通过证据。验收对象是包含 `LazyArmorDeviceBridge`、`LazyArmorNotificationListener` 和 Android Keystore 实现的候选 Android 构建。

> 当前信任级别为 `key_proven`：设备在 Android Keystore 中生成不可导出的 P-256 私钥，并对服务端的一次性五分钟挑战签名。它不是 Google Play Integrity 或 Android Key Attestation 的硬件级证明；在引入并验证该独立能力前，不得将其表述为硬件证明或高风险操作授权。[1] [2]

| 验收项 | 必须提供的真实证据 | 不可接受的替代品 |
|---|---|---|
| Android 构建 | CI 或本机 Android SDK 完成候选包构建的日志与包哈希 | TypeScript/Web 导出通过、Expo Go 页面 |
| 设备密钥 | 添加连接时 `POST /trusted-devices/challenges`、`POST /trusted-devices/challenges/:id/verify` 的 2xx 记录；`GET /trusted-devices` 返回 `key_proven` / `active` | 客户端伪造 ID、公钥或固定 signature |
| 真实发现 | `PackageManager` 返回的一项真实可启动应用被添加；返回的名称、版本、`packageName` 和发现指纹与该设备页面一致 | 目录预置品牌、Mock 数组、服务端补造名称/版本 |
| Generic 准入 | 选择一项**不命中 Enhanced Adapter** 的真实应用，仍能创建、显示、停用并用户主动打开连接 | 仅证明 Catalog 命中的应用可用 |
| Rail 真实性 | 重新打开应用后 Rail 仅展示 API 返回且仍为启用状态的连接；停用/撤销后该项消失 | 静态图标或离线状态缓存 |
| 通知撤销 | 对一项连接启用通知来源后停用连接或撤销可信设备；其后端侧来源停止同步，服务端拒绝进一步收据 | 只更新界面、不清除本机来源或仅依靠服务器静默丢弃 |

## 执行步骤

在具有 Android SDK 的受控开发/CI 环境中构建候选 Android 包，并使用**两个独立测试账号**和至少一台物理 Android 设备安装。首次开始时，设备上不应有“已连接应用”的预置记录。

1. 登录测试账号 A，打开“我的连接 → 添加连接”。确认展示的是此设备实际可启动应用，而不是固定品牌列表；如设备未返回可启动 App，记录为环境/系统限制，**不得**改用模拟列表。
2. 选择一个真实可启动、且未命中增强目录的应用并点击“确认添加”。该动作才会触发密钥挑战；在服务端确认 `trusted_devices.status=active` 和 `trust_level=key_proven` 后，连接创建请求才可成功。
3. 对该连接执行“打开应用”，确认 Android 启动同一真实应用。断开网络重试，应用不得被当作“已打开”或“已连接”伪报成功。
4. 回到连接中心停用该连接，确认 Rail 不再显示它；通知来源若曾启用，必须同步关闭。进入“可信设备”撤销该设备后，服务端应停用该设备绑定的全部 App Connection。
5. 登录测试账号 B，确认不可看到账号 A 的可信设备、发现连接、收据、Rail 项或消息。此步骤检查用户隔离，而不是验证是否在同一台手机上安装了 App。
6. 如需验证通知来源，单独开启 Android 系统通知访问并在“通知来源”中逐项授权。未授权、已停用或已撤销时，服务端必须拒绝收据；正文和标题不得出现在服务器审计、指标、数据库收据或验收日志中。

## 证据留存与隐私

留存一次验收运行的构建号、构建哈希、时间范围、匿名化测试账号标识、API 状态码、可信设备公钥**指纹摘要**、连接 ID 摘要、审计 action/result 和撤销测试结果。不得留存私钥、挑战签名全文、通知正文、通知标题、设备序列号、整机应用清单或真实个人账户数据。

验收报告必须明确其覆盖的信任等级、系统版本和候选包哈希。Android Keystore 的实现与私钥不可导出属性适用范围、PackageManager 可见性限制和系统通知监听服务的声明要求，以 Android 官方文档为准。[1] [2] [3]

## 通过与阻断结论

只有表中所有项目都具备真实证据，才能将 Generic Connection 的**真机发现/撤销路径**标为 Beta verified。即便通过，该结论也不允许支付、转账、下单、账户修改、Accessibility 自动点击、Provider 专属解析，或将通知线索写为品牌事实。Parser、Classifier、Normalizer、Truth Store、资源验证与 Plan Engine 消费另有独立验收门槛。

## References

[1]: https://developer.android.com/privacy-and-security/keystore "Android Keystore system"
[2]: https://developer.android.com/privacy-and-security/security-key-attestation "Key attestation"
[3]: https://developer.android.com/training/package-visibility "Package visibility"
