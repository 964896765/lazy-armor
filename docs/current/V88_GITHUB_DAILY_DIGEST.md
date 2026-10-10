# V88-LOOP-04 / V88-GITHUB-01 — 每日公开日榜与七天记录

目标由本人确认：GitHub 公开 Trending 日榜，所有语言，前 10。默认每天北京时间 09:00；App 自主读取、生成写作提示词、形成中文概览和十项摘要，发送站内通知。不是由 Codex 代写每日内容。

## 实现边界

- 来源固定 `https://github.com/trending?since=daily`，保留页面原始顺序、仓库链接、描述、语言、总星标、当日星标、读取时间和原始 HTML SHA256。缺失字段为空，少于十项、重复仓库、异常地址或验证页面失败；不生成替代榜单。
- 沿原公开网页 Connector、本人网站范围和逐项 permission。原荆门官网授权不涵盖 GitHub。固定日榜模式直接读取 GitHub，不用必应；TLS/DNS、公网地址固定、无 cookie/脚本/跳转、1 MB 和超时限制继续适用。
- 沿原 Plan 创建、ready、apply、active、Execution、Task Scheduler、Worker、ActionExecutor、站内 Notification。原 execution-worker tick 加触发适配器，无第二个 timer。定时 requestId 由服务器生成，按版本＋触发器＋真实时刻去重，客户端不能伪造保留前缀。
- 原 SQL CHECK 只允许既有来源类型及 `executions.trigger_type=manual`。因此使用原 file 来源类型（网页 Connector 原 providerType 为 file）和严格 `github_trending_daily` 配置；执行表保持原 manual 值，服务器触发快照、事件及只读 `triggerOrigin=SCHEDULE` 标出实际定时来源。零新 SQL，不修改既有 CHECK。
- 每次读取和模型阶段间重新核对来源授权。发送站内结果时锁定现有 Plan/Execution/Connection/Permission/Grant/Credential/Health 行，重核对后沿原 Notification/Usage 同事务保存；结束前再检查。撤销后重新授予也不能发布旧响应。暂停、取消和版本变化阻断。
- 每日读取先检查本人现有 permission，再续检过期的网站 Health，之后捕获新的读取授权。原五分钟检查过期不会把翌日计划永久卡住；未授权时不触发连接检查或内容网络读取，历史已保存摘要仍按原授权和时效核对。
- 自动提示词和摘要调用本人既有模型配置，结构化输出限定原仓库名称及顺序，最多一次合同纠正。信息、提示词和网页描述都是不可信资料。排名对比由程序计算，只与上次成功汇总比较；首日没有基线。没有读取提交、发行或作者活动，不将日榜叫作全站动态。
- 生成结果和来源授权保存到原 step output。Worker 中断恢复仅重用同一次执行的已保存来源，并重核对当前授权和时效，通知按 execution 去重。运行记录可展开提示词、读取依据和十个原仓库链接。
- 启动页展示目标与范围；可先准备草稿，授权和启动由本人操作。启动 API 可传已审阅版本 ID，并在原锁内拒绝变化后的版本；不自动启动新计划。

## 七天统计

`GET /plans/:id/agent-loop/coverage` 是 owner-only、只读的最近七个北京时间日历日期统计，含今天未结束部分。RUN 与 WAIT/checkpoint 分开计数，只取正在使用的版本；有记录日期不等于连续运行证明，静默等待无记录不等于停机。每类最多 500 条并标识统计是否完整。历史分页、缓存和版本变化相互隔离。

`continuityVerified=false`、`executionAuthorized=false` 始终保留。公开网页和 AI 摘要仍为 `SOURCE_RESPONSE_ONLY`，不写个人 Truth，不把执行成功自动升级为实际事实核实。完成站内汇总后保留 WAITING_NEXT_SCHEDULE 检查点。

七天验收需收取七个真实日期的计划运行、来源、生成与通知记录。停机错过当日触发时刻不补造记录，历史失败不复活。测试中的固定来源、未来触发时刻都是隔离 fixture，不能计入本人七天证据。

## 验证与证据

- GitHub/模型/原网页/Loop/Truth-source 专项与回归：`artifacts/v88-github-tests-final-r6.log`，30/30。随后冻结 Plan 与启动版本核对另有增量专项。
- 既有 coverage 合同 10/10、API/Reflection 24/24、Mobile 7/7；见 `v88-loop-coverage-*.log`。
- 实际公网适配器探针：`artifacts/v88-github-public-network-probe-r1.json`，读取 611382 字节并解析十项；仅诊断，不代表本人资源授权或 Plan 运行。
- 最新增量冻结与启动/执行专项：`v88-github-frozen-plan-tests-r7.log` 12/12，`v88-github-scheduler-tests-final-r9.log` 8/8（与之前重叠，不重复累计）。新增启动版本检查包含在最后八项内。
- 每日过期 Health 续检增量：`v88-github-daily-health-tests-r10.log` 9/9，含旧检查过期后的自动续检和未授权时零检查网络；API build `v88-github-api-build-health-r4.log`。
- 八包 typecheck：`v88-github-typecheck-final-r5.log`；API build：`v88-github-api-build-final-r3.log`；最终 APK/Hermes：`v88-github-digest-package-r3.json`。三角色替换前 execution/outbox lease 与 active report 均为零，随后 ready 200/200/200：`v88-github-digest-runtime-r1.json`、`v88-github-digest-ready-r1.json`。
- 手机 2c696fe 沿保留数据覆盖安装，APK SHA256 `d39f80ec1111a2a3f1e952477b5ba04c221b15e945581f59f514793924e06e44`，HBC SHA256 `e65e385f75b62f86ab209d1339bd8576038969753df2044f6f61e298476edd89`；安装包与实际 package、内嵌 HBC 一致：`v88-github-digest-install-verification-r3.json`。十二个原登录/Runner 文件及构建 bundle 恢复检查通过：`v88-github-preservation-final-r2.json`。
- 正常已登录 App 添加独立 GitHub 范围并创建可审阅草稿 `01a126a4-a7ab-73ed-b14e-0a5a9aa4dbe4`，版本 `01a126a4-a7b0-733d-997f-d0cb002cb7cd`。`v88-github-phone-draft-r2.png` 和 owner-only 只读 `v88-github-phone-start-check-r2.json` 确认 draft、无执行、无新增授权。用户已回复计划已审阅；新 GitHub 读取权限仍未开启，已将手机停在该新范围页请本人补齐。未提取手机 token，未用 SQL 创建或启动个人计划。
- 后续只读 `v88-github-phone-prepush-status-r3.json` 已确认本人补齐 `READ_PUBLIC_WEB_RESEARCH` 授权；计划仍为 draft、无执行。推送收尾时本机 Redis 退出，已恢复原 Docker Desktop 和原 Redis 容器（PONG），在零 lease/active report 后重启原三角色。该主机恢复不创建个人运行或改写授权。
- 为隔离原有十二个修改，直接从待提交 index 提取 953 个源码/配置，使用其原登录与 Runner 版本单独核验：API/Mobile typecheck 均通过，见 `v88-github-index-api-typecheck-r1.log`、`v88-github-index-mobile-typecheck-r1.log`。提交检查无 whitespace 错误。

当前完成：开发、隔离验证、本地三角色更新、真机安装、可审阅草稿及本人新 GitHub 范围授权；当前待验：原 App 启动、首次真实运行和七个真实日期。V88/V90 保持 IN_PROGRESS。V87 外部 Act/read-back、V89 实际第三方与 0083 发布门仍独立待验。用户随后明确要求推送 GitHub，已进入当前 codex 分支提交/推送收尾；独立登录和设备 Runner 改动保留在本地，验收截图、运行快照、APK 和密钥不进入仓库。无生产发布。
