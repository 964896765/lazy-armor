# V90 五页联合验收与实际来源读取

任务编号：V90-BETA-02。

目标：复用日程、计划、会话、资源、服务的原入口，联合验证受控 Memory、固定方法引用、资源核对和实际来源读取，并记录当前真实验收条件。

Backend：新增五页 backing API 联合专项，沿原 Mobile 方法选择/会话创建函数、Memory API、Planner、方法资源核对和 Connection inspection 验证。另修复 Loop 分页 DTO 仅重声明上限后丢失完整校验的问题；列表与历史明确限制整数 1～20，拒绝 0、负数、小数和超限值。

Frontend：无本轮产品源码变更。联合专项读取 `/timeline?date=all`、`/plan-library`、`/conversations`、`/consumer/resources`、`/service-offerings`，证明这五页的后端接口可读；没有本人真机点按五页的证明。

Database：零新 SQL。测试只迁移 `lazy_armor_v88_v89_20261010_test`，连接 MySQL 3311；Redis DB 15 每轮使用新 prefix。使用虚构隔离账户、开发用 Memory 和本人类型的 USER 方法包，不读取当前用户资料或借用用户 token。

Runtime：复用原执行/授权/核实权威。本专项中的方法和 Memory 均进入非可信来源区；资源缺失不会授予能力，方法撤回后保留原选择并拒绝继续核对，关闭 Memory consumption 后仍保留可读历史。读取来源响应通过明确 grant 的原 `POST /connections/:id/invoke` inspection，返回 `SOURCE_RESPONSE_ONLY`；本次没有创建 Plan、Execution、Invocation、DeviceTask 或 Truth。

## 自动与实际来源证据

| 检查 | 结果 | 本机证据 |
| --- | --- | --- |
| 五页隔离 fixture 联合专项 | 5 通过，1 项真实分支跳过 | `artifacts/v90-beta-journey-fixture-r1.log` |
| 显式真实模型/来源模式 | 6/6，包含同一组 5 项 fixture 和 1 项真实分支 | `artifacts/v90-beta-journey-real-r1.log`、`artifacts/v90-beta-journey-real-r1.json` |
| 关联 API 回归 | 6 文件 50/50 | `artifacts/v90-beta-api-regression-r1.log` |
| Mobile 全套 | 65 文件 412/412 | `artifacts/v90-beta-mobile-tests.log` |
| 本地 readiness 单元测试 | 5/5 | `artifacts/v90-beta-readiness-unit-r1.log` |
| 八包 typecheck、API 构建 | 通过 | `artifacts/v90-beta-typecheck-r1.log`、`artifacts/v90-beta-api-build-r1.log` |
| 当前本地条件只读探测 | exit 2，条件未齐备 | `artifacts/v90-local-readiness-r1.json`、`artifacts/v90-local-readiness-r1.log` |

真实模式只调用一次已有明确启用的开发 DeepSeek 配置。模型实际消费虚构 Memory 和两个固定方法引用；随后原资源核对返回所选公开 HTTP Connection READY，再经原 inspection 实际请求 `https://registry.npmjs.org/typescript/latest`。返回包名 `typescript`、版本 `7.0.2`，来源观测时间 `2026-10-10T06:36:28.030Z`，核实级别 `SOURCE_RESPONSE_ONLY`。这是当时的来源返回，版本变化不影响下一次验证。

5 项 fixture 在两轮运行中重复，不累计为 11 项独立测试。真实模型与真实 HTTPS 响应已经取得证据；虚构账户/Memory/USER 方法仍属隔离测试，不能计为本人授权、第三方方法包、Goal Runtime 执行、Truth 核实或七天连续运行完成。Shared schema、Web/Android 构建未在本轮重跑。

## 复现

在仓库根目录运行，日志/JSON 必须使用不存在的新路径；脚本拒绝覆盖证据。

```powershell
pnpm beta:readiness --device 2c696fe --output artifacts/v90-local-readiness-r2.json
pnpm beta:journey --log artifacts/v90-beta-journey-fixture-r2.log
pnpm beta:journey --real --log artifacts/v90-beta-journey-real-r2.log --evidence artifacts/v90-beta-journey-real-r2.json
node --test scripts/verify-v90-beta-readiness.test.mjs
```

readiness 只检查现有 API `/api/health` 与两个 Worker `/ready`、设备连接/安装/系统 observer 状态和迁移门。HTTP 200、仅 liveness、依赖降级或 Worker 角色不符均不能算 ready；输出不复制响应私有字段或传输错误原文。它不启动服务、不操作屏幕、不登录或修改权限，始终将 Beta 本身标记为 `REAL_PENDING`；exit 0 只表示这些本地条件齐备，exit 2 表示尚未齐备。

journey 使用已有测试 MySQL 容器 `lazy-armor-v81-test-mysql-20261005` 的本地凭据和构建好的 database package；凭据不打印。默认 fixture 模式不加载 `.env`，只有显式 `--real` 才加载已有开发配置。实际调用失败时保留新日志与未通过证据，不切换当前服务或降低生产门。

## 当前现实条件与关闭范围

2026-10-10T06:33:59.561Z 的探测源 HEAD 为 `ab8318be1e6bee7f8f25930cbbf586708dda7ed7`，本轮代码尚未提交：API 3001、execution 3011、outbox 3012 均不可达。手机 `2c696fe` 已连接且安装 `com.lazyarmor.app`，安装更新时间 `2026-10-10 01:22:12`；页面 observer 系统权限未开启。本人正常登录及 App 读取 consent 为 `NOT_CHECKED`，不推断已同意。

历史 `0083_runtime_authority_sources.sql` 的 destructive release evidence 门仍未通过。原 baseline 保留，无豁免或生产迁移；本轮未部署三角色服务或安装 APK。12 个独立登录/设备 Runner 文件 SHA256 不变，保留在工作区，按用户已有授权只提交本轮文件并推送当前 codex 分支。新本机 `artifacts/` 证据不上传，GitHub 中保留此范围/结果说明与复现代码。

完成状态：本轮实现、自动检查和 API 构建已完成；真实开发模型消费和公开来源响应已验证。V90-BETA-02 总体仍 `IN_PROGRESS / REAL_PENDING`，不发布 Beta 完成结论。

下一任务：继续同一 V90-BETA-02，取得正常环境/发布门证据、本人五页入口及 Memory 授权消费、真机 Observe→本人核实→原目标结果、实际第三方方法与实际资源组合、合法 Goal Runtime 闭环和七天持续运行证据。每项保留独立来源与时间，齐备后再关闭 V84～V90。
