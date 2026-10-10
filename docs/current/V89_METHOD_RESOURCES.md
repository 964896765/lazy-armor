# V89-SKILL-04 · 所选方法的资源能力核对

目标：从原会话中明确选择的方法查看所需能力、本人资源的当前可用状态与缺口入口，补充资源后重新核对，并回到原目标继续合法确认。

Backend：新增只读 `GET /conversations/:id/method-resources?version=…`，复用原 GoalResourceMatchService、CapabilityUsabilityService、FactDemandResolver 与本地能力投影。只读取本人当前、未归档的会话及服务端保存的确切方法引用；不接受客户端追加能力、来源或执行权限。计算前后复核会话版本、上下文与方法状态，更新、关闭、归档或期间撤回返回冲突。最多三个方法保留选择顺序，每个方法内仅按既有明确 canonical alias 去重，不把不同能力合并。

资源状态：沿原授权、Credential 到期、Health 时效、原生证据与设备心跳检查；连接存在不等于可用。另核对当前服务是否装载对应 Adapter、能力和 operation handler，持久化目录仍可用但 Adapter 未装载时返回 UNAVAILABLE。显示本人连接名称与恢复入口，不返回 Credential 或其它用户资源。通知缺少 App 来源、页面缺少 App/字段范围时返回 NEEDS_SELECTION，即使系统通用许可已开启也不显示就绪。

Frontend：原会话方法卡片增加“核对方法所需资源”，二级页按方法分组显示所需能力、缺口原因、资源实际操作风险与补充入口；重新聚焦/点击重新核对读取当前状态。原 Goal 资源页复用同一 ResourceRequirements 组件。资源页返回按钮统一为“返回原会话”，保留原临时/计划上下文；五个一级页不变。

Database：零 SQL 迁移、零新表、零回填。仅扩展共享 TypeScript 只读投影；原方法 Revision、会话 JSON、PlanSkillReference、授权和证据表继续作为来源。

Runtime：核对不读取网站/App/接口，不刷新 RuntimeTarget，不创建 Plan、Execution、Invocation、Truth 或审计写入。方法声明风险单独展示，实际资源 operation/risk 由原能力目录提供；方法 R0 不能把 Browser 的实际 R3 降险。`executionAuthorized: false` 始终保留；READY 是本次读取的状态，具体目标范围、审批和实际执行仍由原 Resolver/Policy/Runtime 当时复核。没有新增 Skill Engine 或执行绑定。

Test：新专项 14/14，覆盖 owner/version/严格查询、无方法、归档、三个方法顺序、空能力、别名去重、缺少通知与页面范围、正常撤销/恢复授权、Credential/Health 到期、真实结构的原生证据与过期心跳、Adapter 未装载、R0/R3 分离，以及计算期间方法/会话变化拒绝；验证核对没有源 I/O、目标刷新或上述 Runtime/Truth/审计写入。最终关联 API 7 文件 71/71，包含原 Goal 资源/页面、Resource/Native 能力、方法会话与 ACTION_PROPOSAL 回归。Mobile 全套 63 文件 388/388、Plan-schema 全套 46 文件 251/251、八包 typecheck、API/Web 构建及 Android Hermes export 全部通过。新专项包含在 71 内，不重复累计。

本机证据：

- `artifacts/v89-method-resources-regression-final.log`
- `artifacts/v89-method-resources-mobile-tests-final.log`
- `artifacts/v89-method-resources-schema-tests-final.log`
- `artifacts/v89-method-resources-typecheck-final-r2.log`
- `artifacts/v89-method-resources-api-build.log`
- `artifacts/v89-method-resources-web-build.log`
- `artifacts/v89-method-resources-android-build.log`

失败记录保留：最初撤权断言误用 CAPABILITY_NOT_GRANTED，按原权威返回值修正为 CAPABILITY_GRANT_REVOKED，没有修改生产撤权语义；typecheck 发现 SDK 的 providerAvailability 可选，缺失时按 disabled 拒绝就绪。修正后上述最终回归和类型检查通过。测试在 `lazy_armor_v88_v89_20261010_test` / Redis DB 15 与每轮独立 prefix 运行，没有重跑会重启共享容器的全套 API。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED。Browser health 与 native evidence 是明确隔离夹具，不证明真实网站或手机能力已验收；本人 UI、实际第三方方法/模型/资源组合、V88 七天和 V90 五页现实闭环仍 REAL_PENDING，V89/V90 整体 IN_PROGRESS。历史 0083 release evidence 门保留，当前生产迁移、服务部署与 APK 安装未执行。12 个独立登录/设备 Runner 文件 SHA256 不变，保留工作区且不纳入本任务提交；按已有用户授权提交并推送当前 codex 分支。

下一任务：方法 Revision 更新管理的用户入口，复用已有追加版本与不可变引用合同；真实第三方方法→目标→合法确认→实际资源→Verification 闭环继续独立收取，不以自动验证代替真实验收。
