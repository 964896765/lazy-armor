# V86 Resource Capability · 逐项能力与时效一致性

任务编号：V86-RESOURCE-01。

目标：资源页能回答“当前能够读取或执行什么、缺什么”，能力列表、Planner Readiness 和 Resolver 使用相同的连接/授权/健康时效门。

背景：接续 V85 Store、候选确认、引用、关系及真实 DeepSeek 的隔离 API 生命周期验收。本人手机记忆操作仍待正常登录，独立保留 REAL_PENDING；按最新连续开发授权推进 V86，不重开 P3，不提前 Computer Use。

Backend：沿用 ProviderCapabilityRegistry、CapabilityUsability、既有 `/connections/:id/capabilities` 与 Resolver。连接状态不是健康证据；过期/无截止时间/未来时间的正向健康记录不能标为可用。授权检查包含过期、撤回、required OAuth scopes 和证据 provider 归属。旧失败状态不随截止时间自动变成 HEALTHY，须新的成功检查。

`capabilityAvailability` 是共用的派生时间/权限检查，能力列表和 Resolver 均读取原 connection/grant/health 权威，不写新状态。显式能力禁止优先，缺实现和官方能力未核实继续 fail closed。既有 BETA adapter 的资源级可用语义保留；Resolver 仍按自身 PRODUCTION、账号、设备、资源字段、purpose、现实证据、成本、风险和 freshness 合同筛选，不降低原任务门槛。

接口变化：能力投影增加 canonicalKey、evaluatedAt、健康检查时间/有效期/fresh 与固定 `executionAuthorized=false`。Consumer 资源投影从同一能力服务生成 capabilities 与 capabilitySummary，移除另一份独立的 grant/health 简化判断。无凭据、token 或私密配置输出；owner-only 接口不扩授权范围。

Frontend：资源列表显示可用能力数量及名称；云端/接口详情共用逐项能力组件，展示信息读取/消息订阅/执行操作、来源、授权、检查时间和可用状态。授权变更、检查连接和断开资源后刷新列表与能力缓存。状态使用“权限不完整”“授权已过期”“检查已过期”等用户语言；执行能力保留单独确认语义。没有新增一级页面或 Runtime UI。

Database：无新表、无新迁移、无新的 Resource Authority。Provider/Permission/Credential/Health 继续使用现有权威。健康投影本身不证明凭据、目标账号、特定事实或最终执行成功，实际执行仍由原 Runtime 重新检查。

Runtime：不新增执行器或资源直写入口。原 PLAN / USER_EVENT_SYNC、Resolver、Risk/Approval、Invocation、Runtime、Verification/Truth 和恢复逻辑保持原路径。只共享现有时间与权限门，匹配到资源也不等于已授权执行。

Tests：新增隔离 MySQL 集成比较 owner 能力投影与真实 Resolver，覆盖过期/无 TTL/未来检查、授权撤回/过期/缺 scope、错误 provider 身份、断开连接、负向健康保留、显式禁止和零执行授权。既有 GitHub 隔离 TCP 回归核对 Consumer 摘要与逐项能力一致；移动端呈现覆盖有效/待接入/待核实/权限和检查过期。fixture、隔离 HTTP 和只读 projection 不作为真实用户调用证明。

Acceptance：正常登录→资源详情查看逐项能力→显式授权/检查→会话目标经原 Resolver/确认/Runtime 调用真实来源→现实核对→结果。过期或撤回之后入口不能继续冒充可用。本人账户连续真机能力调用仍 REAL_PENDING，不用历史 P3 空读、隔离样例或页面构建代替。

完成状态：V86-RESOURCE-01 IMPLEMENTED / AUTOMATION_VERIFIED / DEPLOYED / APK_INSTALLED；V86 整体 IN_PROGRESS，真实本人入口/调用待正常登录。本地 checkpoint 不推送。

下一任务：V86-RESOURCE-02 在既有资源/能力入口沿同一 Runtime 完成目标匹配与实际调用验收；正常登录受限时推进独立合同与产品工作，随后按冻结顺序进入 V87。

## 本地验证、部署与安装 · 2026-10-09

最终 API 8 文件 69/69 通过，Consumer 产品投影 unit 另 3/3 通过；opt-in 真实模型套件默认跳过 5 项，不意外调用模型。Mobile 4 文件 32/32、API/Mobile typecheck、Plan-schema/API/Web/Android build 通过。本轮无数据库迁移；新隔离 schema 只用于回归，90 个历史迁移执行于此前为空的测试库，不表示历史 0083 的 production release evidence gate 已通过。

失败记录保留：r1 在已有测试库领取历史恢复记录时发生 MySQL deadlock；r2 在新测试库出现 GitHub 执行前 PERMISSION_DENIED，原 Runtime 未放宽。增加不含 payload/凭据的 dispatch code/origin 诊断后，同一 GitHub 套件 15/15、最终同一断言全组 69/69 通过；没有把未复现的执行前拒绝标记为已修复产品缺陷。

Execution/Outbox 活跃租约均为 0 后替换本地三个角色，3001/3011/3012 都 200/ready。开发库只读核对 Memory/Candidate/Relation/enabled users 仍为 0。API 与源码/构建一致，覆盖安装保留数据与正常登录。

资源能力 APK 已安装在 `2c696fe`，源码 bundle 与 APK 内 bundle 一致，安装包 SHA256 与构建一致：`60e9dcef7f264e1bfcf7cf12787c8963480ecf2543fbb0d4c640ad44aa470760`。安装不是本人手机能力页点按或真实目标调用证明；V86 保持 IN_PROGRESS，不推送 GitHub。

本机证据：`artifacts/v86-resource-capability-tests-final-r4.log`、`v86-github-dispatch-diagnostic-r3.log`、`v86-resource-fresh-test-db-r2.json`、`v86-resource-deployment-r1.json`、`v86-resource-readiness-r1.json`、`v86-resource-development-authority-counts-r1.json`、`v86-resource-capability-r1-install-real.json`。前面的失败日志独立保留。


2026-10-09：V86-RESOURCE-02 的实现/验证见 [目标资源核对与来源检查](V86_GOAL_RESOURCE_MATCH.md)。手动接口读取属于既有 consumer inspection，不作为新的 Goal Runtime Golden Flow 或 V86 CLOSED 证据；本人入口待验继续独立保留。
