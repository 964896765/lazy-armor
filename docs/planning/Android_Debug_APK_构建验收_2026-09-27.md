# Android Debug APK 构建验收（2026-09-27）

## 1. 验收结论

- 基线：`feat/v6-integration@73dd2c06a1678d6408c2001481a0826c09f7e3f8`
- 隔离分支：`fix/android-build-gate`
- 隔离 Worktree：`C:\la\lazy-armor-android-gate`
- 独立 Gradle 缓存：`C:\la\.gradle-android-gate`
- Debug 构建：**通过**，最终 `:app:assembleDebug` 退出码为 `0`
- APK 签名：**通过**，`apksigner verify` 退出码为 `0`，使用 Android Debug 证书和 APK Signature Scheme v2
- 原生代码再生：**通过**，配置插件中的 8 个 Kotlin 源文件与干净 Prebuild 后生成文件逐文件 SHA-256 相等
- Android 真机功能验收：`EXTERNAL_ACCEPTANCE_PENDING`
- 真实 Provider 验收：`EXTERNAL_ACCEPTANCE_PENDING`

本记录只证明本地 Windows 构建、配置插件再生、静态权限及 Debug APK 签名通过，不替代真机、真实 Provider 或同 SHA 远端 CI 验收。

## 2. 隔离与备份

开始前保留了既有三个 Worktree，未清理或覆盖其他工作区。独立 Worktree 从指定基线创建。

Prebuild 前备份位于：

`C:\la\android-gate-backups\20260927-014610-73dd2c0`

其中包括原生目录压缩包和 Prebuild 前 SHA-256 清单。

检查时不存在并发运行的 Gradle/Java 构建进程；独立缓存目录写入测试成功。Windows Defender 实时保护保持开启，没有关闭系统安全防护。

## 3. 原生代码可再生性

以下配置插件已审计：

- `apps/mobile/plugins/with-lazy-armor-android-runtime.js`
- `apps/mobile/plugins/with-android-release-signing.js`

`with-lazy-armor-android-runtime.js` 可恢复：

- Usage Stats、前台服务和通知权限；
- 通知监听服务、前台读取服务、文本分享接收 Activity；
- `DeviceAppBridgePackage` 注册；
- 8 个 Kotlin 原生运行时文件；
- UTF-8 JVM 参数和 Windows 路径检查覆盖。

`with-android-release-signing.js` 继续只从环境变量读取 release 签名材料，并禁止 staging/production 使用 debug signing。本次没有引入或记录 release 凭据。

干净 Prebuild 后，下列 8 个插件源文件与生成文件哈希相同：

- `AppReadForegroundService.kt`
- `AppReadSessionStore.kt`
- `DeviceAppBridgeModule.kt`
- `DeviceAppBridgePackage.kt`
- `ForegroundPackageGuard.kt`
- `GenericNotificationNormalizer.kt`
- `LazyArmorNotificationListener.kt`
- `LazyArmorShareReceiverActivity.kt`

## 4. 本次发现及修复

首次构建虽然成功，但最终 Debug APK 仍包含 `android.permission.SYSTEM_ALERT_WINDOW`。根因是 Expo 的 `debug` 和 `debugOptimized` 覆盖清单在主清单的 `blockedPermissions` 处理之后重新声明了该权限。

修复采用现有 Android runtime 配置插件的危险模组阶段，在每次 Prebuild 时确定性移除两个 debug 覆盖清单中的该权限；没有只修改一次性生成文件。插件在无法移除已声明权限时会中止 Prebuild。

最终 APK 已确认不包含：

- `READ_EXTERNAL_STORAGE`
- `WRITE_EXTERNAL_STORAGE`
- `SYSTEM_ALERT_WINDOW`
- `USE_BIOMETRIC`
- `USE_FINGERPRINT`

## 5. 构建环境

- OS：Windows 11 amd64（10.0.26200.0）
- Node.js：20.19.4
- pnpm：9.12.0
- Java：Microsoft OpenJDK 17.0.10
- Gradle Wrapper：9.3.1
- Android Build Tools：36.0.0
- compileSdk / targetSdk：36 / 36
- minSdk：24
- NDK：27.1.12297006

构建日志：

- 初次完整诊断：`C:\la\lazy-armor-android-gate\.codex-runtime\android-gate\assemble-debug.log`
- 权限修复后构建：`C:\la\lazy-armor-android-gate\.codex-runtime\android-gate\assemble-debug-permission-fix.log`
- 最终干净 Prebuild：`C:\la\lazy-armor-android-gate\.codex-runtime\android-gate\prebuild-clean-final.log`
- 最终 Debug 构建：`C:\la\lazy-armor-android-gate\.codex-runtime\android-gate\assemble-debug-final.log`

最终构建结果：

- `BUILD SUCCESSFUL in 8m 23s`
- `353 actionable tasks: 325 executed, 28 up-to-date`
- `ASSEMBLE_DEBUG_FINAL_EXIT=0`

Gradle 9 输出了来自 Expo/React Native 依赖及 Groovy DSL 的弃用警告；本次没有出现 `SoftwareComponent with name 'release' not found`。这些警告不影响本次 Debug APK 产出，但升级到 Gradle 10 前需要由依赖升级任务单独治理。

## 6. APK 交付物

- Gradle 输出：`C:\la\lazy-armor-android-gate\apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk`
- 稳定交付副本：`C:\la\android-artifacts\lazy-armor-73dd2c0-android-gate-debug.apk`
- 文件大小：`222580206` bytes
- SHA-256：`841B4D476C39EF169DBA6DE6F85E8DC6BB6C62E0D71E241A3384B1435EE127DA`
- applicationId：`com.lazyarmor.app`
- versionName / versionCode：`0.1.0` / `1`
- 签名验证：v2 `true`，`apksigner` 退出码 `0`

## 7. 自动化验证

| 验证项 | 结果 | 退出码 / 数量 |
| --- | --- | --- |
| `expo prebuild --platform android --clean --no-install` | 通过 | `0` |
| `node --check` Android runtime 插件 | 通过 | `0` |
| 移动端 TypeScript | 通过 | `0` |
| `@lazy-armor/plan-schema` build | 通过 | `0` |
| 移动端 Vitest | 通过 | 41 files，257 tests，退出码 `0` |
| 最终 `:app:assembleDebug` | 通过 | `0` |
| `aapt dump permissions` | 通过 | `0` |
| `apksigner verify` | 通过 | `0` |

移动端测试首次运行因隔离 Worktree 中 `@lazy-armor/plan-schema/mobile` 的构建产物尚未生成而失败；构建该声明依赖后，原命令复跑全部通过。没有通过跳过测试、删除断言或放宽超时掩盖失败。

## 8. 尚未完成的外部验收

- 尚未在真实 Android 设备上安装并验证通知监听、Usage Stats、分享接收和前台读取全链路；
- 尚未取得真实 Provider 能力证据；
- 尚未取得匹配最终整合提交 SHA 的远端 CI 证据；
- 本次只交付 Debug APK，未执行 release 签名构建。

以上项目保持 `EXTERNAL_ACCEPTANCE_PENDING`。
