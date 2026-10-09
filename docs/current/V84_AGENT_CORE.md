# V84 Agent Core

任务编号：V84.1 Goal Understanding & Controlled Confirmation

目标：在会话中解释真实 AI 对目标的理解，明确生命周期、所需信息/能力与资源缺口，沿现有确认入口进入正确权威对象。

背景：已有 AgentPlanner、ContextCompiler、CreationDraft、USER_EVENT 与 Shared Runtime；会话的方案解释需要统一。保留 Temporary / USER_EVENT / Persistent 路由，不把一次性需求强迫变成长期 Plan。

开发范围：已校验 Planner 输出的只读 GoalUnderstanding、会话理解卡片与既有确认操作。

## Backend

新增 `apps/api/src/agent/intent`、`planner`、`policy` 最小模块，由原 AgentPlanner 调用。`goal-understanding.v1` 只在校验通过时产生，保存在 assistant message 的 `structuredPayload.understanding`。原 Planner 审计仅追加生命周期/能力状态/授权门/生成时间，不复制摘要、用户文本或记忆内容。

合同包含目标、生命周期、执行方式、所需 facts、能力快照、步骤、缺口、Skill 引用、Truth 版本引用、模型身份与生成时间。步骤来自已校验的方案形态，能力需求合并实际编译的 action contract。通知来源身份不能冒充可用。`executionAuthorized` 恒为 false；riskHint 不能成为审批决定。

AI 建议为只读解释；草稿与确认仍由 CreationDraft/UserEvent/ConversationOnce 的 owner/version/lock/latest-message 合同控制。确认冻结权威版本，执行授权与 Risk/Approval 保持独立。

## Frontend

会话新增“我理解的目标”，说明本次处理/个人事项/持续计划、所需能力、生成方案时状态、缺口与步骤。不确定时显示“需要检查资源”，不展示虚构 App 可用性、固定耗时、已完成或已授权。

卡片不携带可执行请求；按钮继续确认后端保存的当前消息与会话版本。执行前复查资源。未知版本、非法或生命周期不匹配的数据不展示。

## Database / 接口

无新表、无迁移、无第二套 Goal/Plan/Truth 权威。现有消息 JSON 和审计添加可选字段，旧消息与客户端兼容。`POST /conversations/:id/messages`、`GET /conversations/:id` 返回可选 understanding；确认接口沿用原合同，不接受客户端提交理解卡片来运行。

## Runtime

复用 Resolver、Policy/Approval、Invocation、Shared Runtime、Verification/Truth。Agent Core 不执行、不改权限、不创建 Truth。内部 USER_EVENT 不要求 Calendar；明确同步意图才展示外部写能力和独立审批要求。

## Tests

覆盖生命周期、非法输出不产生理解结果、显式同步与确认/审批分离、来源身份不冒充可用、编译 action requirement 不被模型遗漏、移动端无授权/假成功表达，以及现有 owner/version/latest-message 确认回归。

## Acceptance

真实验收：用户输入→真实 AI→理解卡片→用户确认→正确权威对象。不以 fixture/构建代替真机，无外部写意图时不得外部写。

当前：IMPLEMENTED / DEPLOYED / REAL_UI_PENDING。自动回归、构建和只读真实模型合同已通过；手机理解卡片→用户确认仍待验，不宣称 V84 CLOSED。

## V84.2 GoalExecutionContext — 时间上下文

目标/背景：相对日期不能只依赖一句用户文本或服务器时区。把用户已有时区和语言设置接入只读上下文，既有 Truth/Capability/Skill/Conversation sections 继续复用。

Backend：GoalExecutionContextService 只选择本人 profiles 的 timezone/locale；验证 IANA 时区和规范化 locale，缺失或非法明确回退。ContextCompiler 将设置和服务器当前时间放在 TRUSTED_RUNTIME_METADATA；附件不能覆盖它。Planner 使用同一快照，理解合同记录此次 timezone/locale。

Frontend：理解卡片显示解释相对时间时使用的时区，事项草稿仍显示实际 dueAt/reminderAt 和事项时区，供用户核对。

Database/接口：无迁移，读取现有 owner profile；原消息接口的可选理解合同增加 timezone/locale。Runtime/确认合同不变。

Tests/Acceptance：owner 隔离、非法设置回退、不可信附件不能改时区、理解结果与本轮 Context 一致；真实模型对“明天下午”使用本人设置的验收单独记账。

当前 V84.2：IMPLEMENTED / DEPLOYED / REAL_MODEL_CONTRACT_VERIFIED。长期 Memory 引用与偏好管理留 V85。

## 本轮验证记录 — 2026-10-09

- 后端 8 个相关文件 57 项通过：V84 理解/时间上下文/真实测试数据库确认，以及既有 Planner、USER_EVENT、ActionProposal、模型协议回归。
- 移动端 3 个相关文件 14 项通过；Plan-schema build、API/Mobile typecheck、API/Web build、Android bundle/APK build 通过。
- 本地 API 已更新；API readiness 通过。执行和 Outbox Worker 保持原进程，本轮不修改执行合同。
- APK 覆盖安装并核对字节一致，SHA256 `ad52ccb785118dd36b7ed70540cbc17821c7828472fda7382ec3288c8c03b8bd`。
- 真实 DeepSeek 只读探针 8/8：本人 profile 时间设置、“明天下午3点”解析、USER_EVENT 校验、无 Plan/外部同步/外部 capability/执行授权。没有保存 Conversation/Event/Invocation/Truth，不属于手机确认链证明。
- 手机目前需要正常登录，用户回复“暂时无法登录”；卡片、确认与最终权威对象的真机体验保留 REAL_PENDING，不绕过登录。

本机证据在 `artifacts/v84-agent-model-contract-r1.json`、`artifacts/v84-agent-core-r1b-install-real.json`、`artifacts/v84-agent-core-api-deployment-r1.json`；原 bundle 路径解析失败日志保留，随后 r1b 构建成功。新 artifacts 仅在原工作区，不随源码上传。
