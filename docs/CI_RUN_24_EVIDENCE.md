# CI #24 公开运行证据

> 采集时间：2026-09-04（公开 GitHub Actions 摘要页只读访问）

| 字段 | 公开可验证值 |
|---|---|
| 工作流 | `release-candidate-ci` |
| 运行编号 | `#24` |
| 运行 ID | `33868047169` |
| 提交 | `b45172cd1f12722e2b265d3b05fef4fef7a7aede` |
| 分支 | `main` |
| 触发 | push，2026-09-04 11:27 |
| 总耗时 | 5 分 7 秒 |
| 总结状态 | `failure` |
| 已失败任务 | `PR Fast Gate`，5 分 3 秒，退出码 1 |
| 后续任务 | `RC Full Gate` 与 `Android Verification Artifact` 未运行 |
| 工件 | 无 |

公开摘要只提供 PR Fast Gate 的退出码，运行日志页面要求登录。因此，**CI #24 不是 MySQL 8.4 迁移、备份恢复、Truth Store 真实并发或 Android 候选包的通过证据**。公开页面另提示被锁定 Action 的 Node 20 运行时弃用警告；该警告不是已确认的失败根因，未获得完整日志前不得据此修改工作流。

## 继续取证所需操作

应以具有仓库 Actions 日志读取权限的 GitHub 会话访问该运行，确定失败步骤和完整日志；修复并推送后，新的运行必须至少产出下列证据才可关闭数据库门槛：

1. `db:rc-integration` 的 MySQL 8.4、迁移、备份恢复通过日志；
2. `p5-truth-store-concurrency.integration.spec.ts` 在 `RUN_REAL_DB_INTEGRATION=1` 下实际执行且通过的记录；
3. `mysql84-migration-evidence-<sha>` 工件；
4. 完整 RC Full Gate 成功结论。

## 重跑尝试 #2 状态

2026-09-04 11:58，已在 GitHub 已登录会话中选择 **Re-run failed jobs**。GitHub 公开运行页显示该次尝试已启动，`PR Fast Gate` 为 `in progress`，`RC Full Gate` 与 `Android Verification Artifact` 等待 Fast Gate 结果。

2026-09-04 11:59，尝试 #2 的 `PR Fast Gate` 在 1 分 25 秒后失败。Job Summary 显示 12 个测试文件中 11 个通过、1 个失败，85 个已执行测试均通过；失败发生在 `apps/mobile/src/plan-presenter.spec.ts` 加载 `@lazy-armor/plan-schema` 时，报错为 package entry (`main/module/exports`) 无法解析。因 Fast Gate 在移动端测试步骤停止，`RC Full Gate`、`Android Verification Artifact`、MySQL 8.4、迁移、备份恢复与真实并发均**未执行**，也未产生工件。该运行另有 Node 20 Action runtime 弃用警告，但不是已确认失败根因。

## 后续 CI #25 与 #26 根因记录

CI #25 已验证移动端在干净环境解析 `@lazy-armor/plan-schema` 入口的缺口；在测试前构建内部 API 依赖闭包后，CI #26 的该步骤、Mobile 90 项测试及 API 安全/设备/Truth Store 聚焦回归均通过。

CI #26 随后失败于 `p5-scale-multi-worker.integration.spec.ts`：子进程 `/live` 未在 20 秒内返回 HTTP 200。因此 Fast Gate 停止，MySQL 8.4 证据工件、RC Full Gate 与 Android 验证均被跳过。根因是该集成测试的父进程明确设为 `APP_ROLE=api`，而生成 Worker 子进程时继承了此角色；入口逻辑会尊重已声明角色，WorkerProbe 因不是 `execution-worker` 而拒绝启动。测试现已显式传递 `APP_ROLE=execution-worker`，这是测试进程角色隔离修复，不改变生产入口的显式部署角色策略。

## CI #27 根因与修复记录

CI #27 的 `PR Fast Gate` 已成功：内部 API 依赖闭包构建、移动端 90 项测试、API 安全/可信设备/Truth Store 回归均已放行。`RC Full Gate` 失败不是 MySQL 8.4 服务不可用，而是 `pnpm test` 经 Turbo 严格环境运行时未声明 `DATABASE_URL` 等必要输入，集成测试回落至开发机默认的 `127.0.0.1:3307` 并被拒绝连接；同时该任务先前只构建依赖而未构建被测 API 本身，令动态 `dist` 安全回归入口缺失。现已将必要环境列入 `globalEnv`，并令 `test` 同时依赖 `build` 与 `^build`。

同次运行中 `Android Verification Artifact` 在开始 Gradle 前失败：PowerShell 脚本只复制了仓库顶层目录，临时工作区没有 `apps\\mobile\\android`。复制逻辑现已改为递归复制，同时保留对 `.git`、环境文件、密钥与生成工件的排除。多 Worker 进程测试还发现父 API 角色会被 Worker 子进程继承，因此两个执行 Worker 测试均已显式使用 `APP_ROLE=execution-worker`。

## CI #29 首次真实数据库证据

CI #29 的 Fast Gate 已通过，且 RC Full Gate 已真实成功执行 `Prepare CI database` 和 `MySQL 8.4 migration and backup/restore evidence`。这首次提供了 MySQL 8.4、全量迁移、前向迁移和备份恢复的实际运行证据。随后完整测试因两个独立问题失败：一是 Truth Store 并发确认触发底层 mysql2 `ER_DUP_ENTRY`，但 Drizzle 包装错误未被幂等处理；二是历史 Worker 故障注入测试尝试 `docker compose` 管理 GitHub Actions service containers。前者已改为识别 `cause.code=ER_DUP_ENTRY` 并重读已提交完整事实；后者只在本地 Compose 运行，CI 保留真实 Worker/Redis/MySQL 正常路径。CI #29 因后续提交被并发策略取消，Android 工件未形成完成结论。

来源：[GitHub Actions Run #24](https://github.com/964896765/lazy-armor/actions/runs/33868047169)；[GitHub Actions Run #26](https://github.com/964896765/lazy-armor/actions/runs/33871515930)；[GitHub Actions Run #27](https://github.com/964896765/lazy-armor/actions/runs/33872113846)；[GitHub Actions Run #29](https://github.com/964896765/lazy-armor/actions/runs/33873822580)

## CI #32 数据库门槛通过与冻结记录

CI #32 的 `PR Fast Gate` 已成功，并上传 `mysql84-migration-evidence-cf7df177b3a8bf15236d6b6479629a41f631938a`。下载的原始 JSON 证据记录：MySQL 为 **8.4.11**，目标数据库为 `lazy_armor_ci_test`，Drizzle 迁移总数为 **36**，并实际确认 `trusted_devices`、`trusted_device_challenges`、`trusted_device_request_sessions`、`trusted_device_request_proofs`、`device_app_connections`、`mobile_notification_receipts`、`truth_records` 和 `truth_record_versions` 均存在。RC Full Gate 中，`p5-truth-store-concurrency.integration.spec.ts` 不再位于失败清单，说明其针对同一收据的并发确认已在 MySQL 8.4 实例中实际通过；此前 `ER_DUP_ENTRY` 幂等恢复路径和断言 API 均已获覆盖。

因此，**冻结数据库功能范围**：后续不得新增、修改或重写任何 Drizzle migration、数据库表、Truth Store 事实字段或设备会话字段。后续工作仅可读取既有数据库事实，并转入 Android 候选包、真实设备发现、可信设备、通知授权、用户确认与双账号隔离验收。CI #32 的 RC Full Gate 仍因历史执行/连接集成套件失败而未整体通过，该问题不改变上述 MySQL 8.4 迁移、备份恢复和 Truth Store 并发的已获得运行证据。

来源：[GitHub Actions Run #32](https://github.com/964896765/lazy-armor/actions/runs/33877999692)，artifact `mysql84-migration-evidence-cf7df177b3a8bf15236d6b6479629a41f631938a`。

## CI #33 Android 候选包失败根因与重试修复

CI #33（run ID `33879809798`，提交 `19d582b6d81aad593c72364d0bdee35703de0038`）的 `PR Fast Gate` 已成功；`RC Full Gate` 的 `Prepare CI database` 和 `MySQL 8.4 migration and backup/restore evidence` 也均实际成功。其完整套件失败仍来自既有执行 Worker、Outbox Worker、连接候选与 operations 时序断言，**不是** MySQL 8.4、迁移、备份恢复或 Truth Store 并发门禁失败。

同次 `Android Verification Artifact` 已在 Windows 环境完成冻结依赖安装、共享运行时依赖预构建并进入真实 Gradle `bundleRelease`；失败发生于 React Native Worklets 的 CMake/Prefab 阶段。日志确认生成的 `prefab_command.bat` 位于深层 pnpm 虚拟存储路径，Java 启动该批处理文件时收到 `CreateProcess error=2`，随后脚本因没有生成 AAB 而在元数据阶段报告 `AAB not found`。这不是 Android SDK/Kotlin 编译成功证据，也不构成真机验收。

针对该真实 Windows 路径限制，验证脚本现在只在短 ASCII 临时工作区的**冻结安装**命令上追加 `--config.virtual-store-dir-max-length=60`，以压缩 pnpm 虚拟包目录名并缩短 Prefab 命令路径；不改 lockfile、生产依赖、Android 原生业务逻辑或数据库。同期还修复 Outbox Worker 真进程测试显式传递 `APP_ROLE=outbox-worker`，防止其从测试父进程继承 `api` 角色后无法启动 `/live` 健康探针。后续 CI 必须重新生成并下载 `DEBUG_VERIFICATION_ONLY` AAB 和 `build-artifact-metadata.json`，核对提交 SHA、工件 SHA-256 与 Android 源文件 SHA-256 后，才能声称已取得 Android 候选工件证据。

来源：[GitHub Actions Run #33](https://github.com/964896765/lazy-armor/actions/runs/33879809798)。

## CI #34 Windows CMake/Ninja 复核

CI #34（run ID `33882779556`，提交 `ac83e2d3716cc16142a1d4a0394b70cf3675eb58`）验证上一轮 pnpm 虚拟存储目录压缩已实际生效：日志中的 Worklets 路径已从完整 peer 后缀缩短为受限目录名，且此前的 `CreateProcess error=2` 不再出现。Android Gradle 仍未产生 AAB，但新的首要失败为 `react-native-screens` 与 `react-native-worklets` 的 `buildCMakeRelWithDebInfo`，Ninja 报告 `manifest 'build.ninja' still dirty after 100 tries`。实际使用的 CMake 为 Android SDK 自动安装的 `3.22.1`；问题发生在 Windows 专用候选工件流水线，不是 Kotlin/Metro 源码错误，也不是数据库门禁失败。

根据 React Native Worklets 的 Windows 构建指南，CMake/Ninja 原生任务需要短、无空格路径，并应避免用禁用 New Architecture、降级 AGP 或降级依赖的方式规避问题。[官方指南](https://docs.swmansion.com/react-native-reanimated/docs/guides/building-on-windows/) 还明确指出应使用足够短的项目路径，并处理 Windows 原生 CMake/Ninja 的路径限制。下一次只在验证脚本中把已复制的短 ASCII 临时目录临时映射为 `L:`，在此驱动器下执行 Gradle，并使用 `--no-parallel --max-workers=1` 隔离并发的 CMake 配置；真实 ABI、New Architecture、依赖版本、生产源码与数据库冻结范围均不改变。工件元数据仍记录真实临时工作区和源码 SHA-256，映射会在 `finally` 中移除。

来源：[GitHub Actions Run #34](https://github.com/964896765/lazy-armor/actions/runs/33882779556)。

## CI #35 短驱动器映射兼容性复核

CI #35（run ID `33885162457`，提交 `8f3a6c9150d3be75e6a45831aef0698bda6be6dd`）证明 `L:` 临时映射已建立，但 Gradle 在 `settings.gradle:8` 的插件 `includeBuild` 解析阶段以 `java.io.IOException: The filename, directory name, or volume label syntax is incorrect` 退出，尚未进入 CMake 编译。根因是 Expo 生成的设置脚本将 `process.cwd()` 通过 `fs.realpathSync` 解析回真实 `C:` 临时目录，再对仍位于 `L:` 的 Node 依赖目标做 `path.relative()`；Windows 跨卷相对路径无效，最终传给 `includeBuild` 的路径语法错误。

修复不改仓库的 `settings.gradle`：验证脚本只在已复制、会在 `finally` 删除的工作区副本中，以计数断言确认两处生成表达式后，把 cwd 基准替换为逻辑 `L:` 路径。这样仍可通过短驱动器映射执行 Gradle 和 CMake，同时避免跨卷相对路径；源代码、依赖、New Architecture、ABI、数据库和最终可发布构建配置保持不变。下一次 CI 仍须生成可下载 AAB 才构成 Android 候选工件证据。

来源：[GitHub Actions Run #35](https://github.com/964896765/lazy-armor/actions/runs/33885162457)。

## CI #36 多 Worker 启动诊断修复

CI #36（run ID `33886273715`，提交 `0ccb6baf50e569bd6396dc2a1e26b356a814260d`）在 Fast Gate 的 `p5-scale-multi-worker.integration.spec.ts` 失败，因此 RC Full Gate 与 Android 验证按依赖关系被跳过。失败信息为第二个真实执行 Worker 的 `/live` 在固定 **20 秒**窗口内未返回 HTTP 200；该测试已显式设置 `APP_ROLE=execution-worker`，不是此前的 API 角色继承问题。该套件原先未采集子进程 stdout/stderr，因此现有日志无法判断冷启动超时、端口监听或启动异常。

为避免用跳过真进程测试掩盖问题，测试已与相邻的真进程 Worker 测试对齐：保存子进程 stdout/stderr、把仅针对 `/live` 的启动等待扩为 30 秒，并在仍超时时输出子进程日志。该变更不改 Worker、生产运行时、数据库、迁移或 Android 代码；它既降低 CI 冷启动造成的非确定性，也会为后续真实故障提供可审计的根因。API 类型检查已通过。本地针对性运行因 `127.0.0.1:3307` 没有 MySQL 服务而在 Nest 初始化前失败，故不能替代 CI 服务容器中的真实集成验证。

来源：[GitHub Actions Run #36](https://github.com/964896765/lazy-armor/actions/runs/33886273715)。

## CI #37 映射路径最终复核与回退

CI #37（run ID `33886886271`，提交 `250fe67e354d2c149c5a748eb0b5d62e3e372fdc`）的 Fast Gate 已重新成功，说明多 Worker 测试的诊断/启动窗口修复恢复了前置门禁。Android 任务仍在 `settings.gradle:8` 的 `includeBuild` 插件解析阶段以同一 Windows 路径语法错误退出，证明仅替换两处 Node cwd 表达式不足以让 Expo/Gradle 的全部路径解析兼容 `subst` 驱动器。故不再采用逻辑盘映射或改写临时 `settings.gradle`。

验证脚本现改为直接使用一个随机、可删除但保持极短的真实路径 `C:\l-xxxx` 作为工作区根；它比原 `C:\laabuild-xxxxxx` 更短，且不涉及 Windows 跨卷相对路径。pnpm 的 60 字符虚拟存储上限和串行 Gradle 原生任务继续保留。该回退只改变验证工作区位置，未改 Android 应用源代码、Kotlin、Expo 设置、依赖、New Architecture、ABI、数据库或迁移。下轮 CI 将以此真实短路径重新验证 CMake/Ninja 与候选 AAB 产出。

来源：[GitHub Actions Run #37](https://github.com/964896765/lazy-armor/actions/runs/33886886271)。

## CI #38 CMake 对象路径证据与外置虚拟存储

CI #38（run ID `33887742617`，提交 `1b98369d00282b067c50eedd207080a29c6ce5e1`）在短真实工作区 `C:\l-7621` 中已越过 Gradle 设置解析并实际进入 CMake。日志给出可量化根因：Worklets 的 CMake 对象目录已有 **198** 个字符，CMake 明确警告其生成对象文件超过 `CMAKE_OBJECT_PATH_MAX=250`，随后 Ninja 以 `manifest 'build.ninja' still dirty after 100 tries` 失败。该证据确认根因仍是原生构建路径，而不是 Kotlin、Metro、业务代码、数据库或真机行为。

pnpm 官方 Node Modules 设置明确支持为 Windows 长路径问题设置独立 `virtualStoreDir`，并要求该虚拟存储不得在项目间共享。[官方文档](https://pnpm.io/settings/node-modules) 同时允许进一步缩短 `virtualStoreDirMaxLength`。因此，验证脚本下一轮会给每次 CI 使用随机、独占、可清理的 `C:\p-xxxx` 外置虚拟存储，并仍限制虚拟包目录名为 60 字符；虚拟存储不再嵌套于工作区 `node_modules`。候选构建完成后脚本会删除该存储；元数据记录其路径以及内容存储路径，保持运行可追溯。此措施只变更 CI 验证安装布局，不改 lockfile、生产安装策略、依赖版本、Android 源码、ABI、New Architecture 或数据库冻结内容。

来源：[GitHub Actions Run #38](https://github.com/964896765/lazy-armor/actions/runs/33887742617)。

## CI #39 外置虚拟存储后的 Ninja 工具链复核

CI #39（run ID `33890402687`，提交 `8871cdf423584fdda150c5bf7bd375f7bf86b9f8`）已实际使用外置短虚拟存储；日志中的 Worklets 原生路径为 `C:\p-a9a1\…`，CI #38 所见的 `CMAKE_OBJECT_PATH_MAX=250` 对象路径警告不再出现。构建仍在 Worklets 的 `armeabi-v7a` `buildCMakeRelWithDebInfo` 中以 `build.ninja still dirty after 100 tries` 结束，故外置路径已消除一项可量化根因，但尚未形成 AAB。

已检查安装的 React Native `0.86.3` 构建脚本，其默认 `CMAKE_VERSION` 为 `3.30.5`；同时 Expo 根项目插件明确支持在 `gradle.properties` 通过 `android.cmakeVersion` 将所有 Android application/library 子项目统一到该版本。下一轮脚本只在销毁的临时副本追加此属性，并同时设置 `CMAKE_VERSION=3.30.5`，使 ReactAndroid、Worklets 与 Expo 子项目使用同一较新 CMake/Ninja 工具链。仓库的 `gradle.properties` 不会修改；此变更不禁用 New Architecture、不降级 AGP/依赖、不改变 ABI，也不影响数据库冻结范围。CMake 版本会写入成功工件元数据，供后续验收核对。

来源：[GitHub Actions Run #39](https://github.com/964896765/lazy-armor/actions/runs/33890402687)。

## CI #40 260 字符 Prefab 路径收敛

CI #40（run ID `33892812415`，提交 `2c776214f85da5aef3d7e8e7dfb7817bceed3ecd`）已确认临时 CMake 统一配置生效，并推进到 `react-native-reanimated` 原生构建。新的精确失败为 Ninja 对 Prefab 依赖配置文件执行 `Stat(...)` 时报告 **Filename longer than 260 characters**；日志中的实际路径长度为 **263**。其中 `react-native-reanimated@…` 虚拟包目录名为 60 字符。该错误解释了即使外置短根目录后仍出现 Ninja 重生成循环的原因，且再次证明问题位于 Windows 原生依赖布局，不在应用 Kotlin/JavaScript/业务层。

验证脚本下一轮将同一独占外置虚拟存储的 `virtual-store-dir-max-length` 从 60 收紧为 **33**。pnpm 的目录压缩算法会把超过该上限的目录收敛为哈希后缀；以 CI #40 的实际 263 字符路径计算，目录缩短 27 字符后的预计路径为 **236**，低于 Windows 260 字符限制。成功元数据将同时记录外置虚拟存储路径和该 33 字符上限。改动仍仅作用于可清理的验证安装布局，不改应用依赖、lockfile、Android 源码、New Architecture、ABI、数据库或迁移。

来源：[GitHub Actions Run #40](https://github.com/964896765/lazy-armor/actions/runs/33892812415)。

## CI #41 Android 假红与 RC Full Gate 首因

CI #41（run ID `33895165275`，提交 `14d3150d398f45a6c8b1afdd005166740b078efe`）的 Android job `101096638693` 已真实完成 Gradle Android bundle，日志显示 **`BUILD SUCCESSFUL`** 与 **`533 actionable tasks: 533 executed`**；随后 `android-verification-14d3150d398f45a6c8b1afdd005166740b078efe` 工件上传成功。任务最终变红发生在上传之后的 `Post Run actions/setup-node`：`Path Validation Error: Path(s) specified in the action for caching do(es) not exist`。原因是验证脚本使用并清理独占的外置 pnpm 虚拟存储，而 Android job 的 `setup-node` 在 post-job 缓存保存时再校验缓存路径。Android job 不依赖该缓存保证正确性，因此只移除此 job 的 `cache: pnpm` 配置；Node 安装、冻结依赖安装、AAB 构建、源码哈希元数据和 artifact 上传均保留，未使用 `continue-on-error` 或任何失败掩盖。

同一 run 的 RC Full Gate job `101096638787` 完整原始日志显示其首个失败用例为 `test/p0-execution.integration.spec.ts` 第 19 项“只重试失败步骤且不重复已成功步骤”。该测试把语义为 `timeout_once` 的连接器故障以普通 `Error` 抛出；产品错误分类对未结构化异常安全地映射为不可重试 `INTERNAL_EXECUTION_ERROR`，所以执行进入 `partially_succeeded`，而不是测试所断言的 `retry_wait`。既有 P0-7 测试已采用结构化 `ExecutionRuntimeError('TIMEOUT', ..., true)` 表示真实的瞬态超时。故仅修正该测试连接器的故障模拟为同一标准 `TIMEOUT` 契约，原有状态、重试次数、事件与幂等断言不变；不扩大普通异常的自动重试范围，避免将未知错误不安全地重试。API 类型检查已实际通过。本机针对性集成测试在使用 CI 等效 `APP_ENV=development` 后因本机 `127.0.0.1:3307` MySQL 不存在而在 Nest 初始化前失败，未将该本机环境缺失误报为测试通过；最终以 CI MySQL 8.4 服务执行为准。

来源：[GitHub Actions Run #41](https://github.com/964896765/lazy-armor/actions/runs/33895165275)。
