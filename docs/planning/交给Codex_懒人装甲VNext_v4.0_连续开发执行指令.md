# 懒人装甲 VNext v4.0｜交给 Codex 的连续开发执行指令

你现在是懒人装甲（Lazy Armor）项目的资深全栈开发负责人、架构审查员和测试负责人。请在我本地仓库 `C:\la\lazy-armor` 上工作，以**仓库实际代码和测试证据**为准，依据本仓库中的 `docs/planning/懒人装甲_VNext_v4.0_160场景17步_全栈升级总方案_2026-09-25.md` 实施后续升级，同时参考仓库现有 README、docs、代码注释和迁移历史。如果规划文档尚不在指定路径，请先告知我需要将它复制到该路径，不要凭空补全 160 个场景或 17 步定义。

## 任务目标

持续改进而不是仅生成分析报告。将现有项目升级为「19 个稳定领域、96 个原有 canonical 场景 + 经审核新增 64 个候选场景（160 为目标）、外层 17 步 Plan Lifecycle + 内层既有 15 步 Execution Lifecycle、8 个既有 StrategyProfile 兼容、事实驱动获取 + 有界计划智能 + 真实可验证执行」的单一系统；最终落实极简移动端、计划与记录、用户本地「私密」、计划驱动「商城」。**后端有效获取、有效策略、有效执行和实际验证优先于界面展示数量。**

## 必须遵守的架构红线

1. 保留现有 Plan Engine、不可变 PlanVersion、Truth、Capability/Provider、Risk、Approval、Execution、Outbox、DeviceTask、Verification、Reconciliation 和 Audit 权威链；不构建第二套引擎或第二套状态真相。
2. 旧 96 个场景的 `key/revision/hash`、历史 PlanVersion、8 个 StrategyProfile 键、15 步内层生命周期与既有 DB 审计保持兼容；新增 17 步是外层创建、运行和持续重评估流程，不能直接替换原 15 步。
3. 160 是规划目标，不是为了凑数立即向用户宣称全部可用。先逐条审查新增 64 个候选场景：去重、事实需求、真实来源、动作权限、验证合同和隐私合规；未达到合同/真实门禁的场景严格标明状态。
4. `Catalog 可展示 ≠ 已实现 ≠ 用户授权 ≠ 设备在线 ≠ Truth 新鲜可靠 ≠ 可以执行 ≠ 结果验证成功`。不得使用 fixture、模拟值、截图或 AI 猜测补成真实可用/成功。
5. AI 只可提出 Goal、StrategyGraph、PlanOffer、DecisionProposal 等结构化建议；正式判断由规则/权威证据验证，外部动作必须经过现有 Risk/Approval/Execution；AI 不得自己审批、执行高风险操作或接触原始密码。
6. 未通过独立发布门禁时，不开启真实支付、自动采购、高风险跨 App 写入、任意可访问性点击等副作用；绝不能在 `OUTCOME_UNKNOWN` 后盲目重试。
7. 对现有仓库中的其他未提交工作保持尊重：不得 `git reset --hard`、`git clean`、覆盖别人文件、强推或直接合并 main；不要暂存 `.codex-runtime/`、`.env`、私密文件、测试用户截图和凭据。
8. 不为追逐框架名称引入冗余组件。先复用现有 NestJS、React Native/Expo、MySQL/Redis/BullMQ、Connector SDK、MCP、Agent Adapter、Android Native Bridge；引入新技术前要有具体缺口、实测收益、风险、成本和退出方案。

## 先做真实核对（第一批次立即执行）

A. 检查当前分支/HEAD、`git status -sb`、`git log` 和相对 `origin/main` 的变更。此前远程参考为 `fix/rc-full-gate-real-db-concurrency@c626e10`，但要重新核实实际 HEAD，不得假设它仍未变化。核对 CI 配置和同 SHA 的 Fast/RC Full/Android 结果；定位 MySQL 8.4 真实数据库并发和 Android 构建的真实失败点。
B. 逐条对照 v4.0 文档与真实代码：`packages/plan-schema` 中的 19 域/96 场景/8 策略/15 步；`apps/api` 中的 capability-resolver、runtime-catalog、reality-pipeline、truth-store、strategy-runtime、ai-adapter、execution、device-tasks、mcp、credentials；`apps/mobile` 的 shell、scenarios、index、plans、commerce、Android plugin/native。
C. 生成一份**已实现 / 部分实现 / 仅测试模拟 / 未实现 / 缺真机或真账号证据**的实际差距清单，精确到文件/函数/数据表/接口。尤其注意 `AiAdapterModule` 当前可能仍使用 `FixtureAgentModel`；服务器加密 credential 不能冒充手机本地私密保险库。
D. 制作 `96→160` 场景审核台账与现有 hash 兼容基线；确认附录候选场景的去重和四大空间仅用于展示映射，不修改历史真实 identity。
E. 在 `docs/` 记录基线、失败复现方法、设计决策、最小后端变更顺序及各工作批次 DoD，随后**立即实施首个能够安全完成的工程批次**，不要只停在计划书。

## 连续开发主线（按依赖推进，独立风险可并行）

**W0 基线与门禁**：在后续小分支上修复/收口 RC Full、MySQL 8.4 并发、迁移/备份恢复、Android 可重复构建；真实真机和平台授权门禁单独记录。先做小改动、细分可审核提交。

**W1 场景与数据合同**：保留旧 96，审查 64 新候选；新增经审查的 Scenario Contract V2（Goal/ResourceSubject、FactDemand、ActionDemand、VerificationContract、Risk、Privacy、Readiness、版本与治理状态）。共享类型/运行时校验/数据库迁移必要性审查和测试先于消费者页面。160 不等于 160 条各写一套引擎。

**W2 有效获取**：复用既有 TruthDependency/CapabilityResolver/RealityPipeline，按 `FactDemand → SourceResolver → Capture → 相关性与身份过滤 → Observation → Candidate → Truth` 升级；为官方 API、通知、分享、用户导入、受控结构化读取、必要时浏览器后备提供等级/用户授权/新鲜度/代价模型。增加营销过滤、去重、乱序、失效、冲突、目的隔离及证据。至少跑通快递和账目两个真实源导向样例；真机条件缺失时只标测试覆盖，不能伪称验收。

**W3 智能计划与 17 步**：在既有 AgentPlanner、Strategy Runtime、Plan Compiler 上添加外层 17 步消费者合同和可持续重评估，不改写内层 15 步。将用户方案拆成 `Goal/Plan Mode`、`StrategyGraph`（分析/总结/跟进/预测/准备/执行等可组合节点）、`ExecutionPolicy`（明确自动化/授权边界）。输出受控 `PlanOffer`，约束事实来源、能力、成本、权限、验证和缺口；用户选择后编译到既有不可变 PlanVersion；不悄悄改变 active 版本或权限。

**W4 有效执行**：复用现有 Action Recipe、Capability Resolver、Execution/Outbox/DeviceTask/Verification，增加 `ActionDemand/ActionResolver`：官方 API、Intent/Deep Link、受控 DeviceTask、受控 Web 和人工交接；先只读/内部整理，再做经批准且可回读的低风险外部样例。以可信结果而非“点击成功/请求成功”判断完成；写后断网、并发和结果未知必须 fail-closed/对账。

**W5 多端与真实渠道**：做 Android 原生 plugin/native 双份一致、通知/分享/结构化读取/任务 claim/lease/heartbeat/离线与撤权真机证据；国产 Provider 逐个核验官方可用性。Cloud Browser 如实施，先隔离只读，后受控写，平台政策/凭据保护/结果回读不过关不得上线。

**W6 最终 UI（可与无副作用后端任务并行）**：取消固定左 Rail，统一顶部 `头像｜首页｜计划｜私密｜商城`；首页「最近」显示轻 3D 叠加轮播，下面「计划」和四大空间横向切换，领域与场景极简树，**计划标题及四大空间末尾不放 `…/＋`**；领域和场景各自保留对应的 `…/＋` 创建语义。顶部「计划」为简洁的全部计划/进度/记录中心。底部固定「搜索｜万事问 AI｜快捷操作」，无传统底部 Tab Bar。对 160 目录进行列表虚拟化、搜索、折叠/状态保留、无障碍/低动效；所有状态来自后端真实 Consumer Projection。

**W7 私密**：在用户设备实现独立本地加密保险库（密码、敏感资料、私密文件、合法导入应用数据）和最小授权代理，Android Keystore、生物识别、恢复与加密备份需单独威胁建模；不得把服务器 LocalEncryptedCredentialProvider 当手机保险库。AI、商城和全局搜索默认不可读取私密数据；真实敏感用户数据上线前必须通过专项安全审核。

**W8 商城**：复用已有 commerce 页面，围绕真实计划生成采购需求、清单、商品/服务来源/规格/报价，之后再接合法商家、订单、支付、物流和售后。交易须走现有风险/审批/执行/验证链，未知结果不重试付款；不开发独立商城调度引擎。

**W9 关系与产品化**：ScenarioRelation/ScenarioBundle 只作为现有 Plan 的可解释组合，增强跨场景复用、降噪、可观测性、模型/渠道成本、用户价值指标和分场景灰度发布。

## 工作方式与交付要求

- **连续推进**：每个安全批次完成代码、测试、文档与小提交后继续下一项，不要每做一个微任务就停下来等待我批准。普通构建/测试错误应自己排查修复并重测。对必须人工提供真实手机权限、第三方密钥、支付商户资质等依赖，明确标为 `EXTERNAL_ACCEPTANCE_PENDING`，先继续其他独立开发。
- **硬停止**：只有可能产生不可逆数据破坏、凭据泄露、高风险生产副作用、破坏已冻结身份/历史 hash、安全迁移无法证明等情况，暂停相关链路并向我报告。不要擅自启动真实资金操作或提交真实凭据。
- **分支**：确保不在 main 直接开发；必要时从当前开发 HEAD 新建目标清晰的小分支。可在本地按批次提交；创建/推送 PR、合并、发布和操作真实外部账号前，先说明目标与风险并让我确认。不要进行破坏性的 Git 清理。
- **每批报告格式**：实际修改文件与 commit → 增量功能/复用点 → 自动化测试及真机/真实账号证据（通过、失败、跳过分开）→ 当前风险/未满足 DoD → 下一个可安全执行批次。报告里禁止用“代码写完”等同于“真实能力通过验收”。
- **阶段成功定义**：不仅有 160 场景目录和 17 步页面，更要证明至少五条黄金用户路径具备真实、可解释、可重复验证的数据和执行证据：账目整理、快递静默管家、设备耗材、家庭补给、每日重要事项；跨平台内容发布先作为独立需要实际渠道验收的增强路径。

现在开始：先输出不超过一屏的当前仓库核验摘要和第一个可执行批次，然后**真正编辑、运行测试并提交第一批安全代码**。如果 v4.0 文档有与代码冲突、空缺或候选 64 场景不成立之处，列明证据并做不破坏历史兼容的增量修订建议，不要静默按猜测实施。
