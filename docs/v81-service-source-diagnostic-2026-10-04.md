# V8.1 来源与投影诊断交付记录

真实开发服务请求：`01a1073e-051a-777b-b896-0a0d31fc5621`。
服务内容为代码与开发环境投影诊断，不代表实体维修或外部服务验收。

## 已交付检查

- 显式来源选择已冻结到 PlanVersion 对应的 PlanCreationContract；来源撤销时不得选择其它候选来源补位。
- 已修正规则评估读取未选来源 Truth 的问题；规则使用当前需求中允许的 TruthVersion。
- runtime 决策与重放增加来源合同检查，来源失效或 TruthVersion 不符时阻止进入既有执行主链。
- 已修正来源解析模块的 Audit 注入缺失；保留既有审计服务。
- 真实服务请求在手机确认预约并开始服务后，后端 WorkItem 为 IN_PROGRESS / WAIT，Schedule 与提供方列表均含同一请求。
- 自动化来源与决策测试 22 项、本机签名读取集成测试 9 项、消费者与持久化计划合同测试 19 项通过。这些是隔离测试，不是六条 Flow 的真机证据。

## 仍需收口

- 自动唤醒尚需最新 worker 激活、完整非空日历事项真机证据，以及 scoped AcquisitionCoverage 与运行评估的衔接。
- 新 File/Share 单次 Artifact 字节证据合同已建立，Android 新合同生产入口仍需接入并验收；文件中的语义事实不会因导入自动获得 Truth Authority。
- 快递、账单、耗材、工作邮箱、语音仍 Pending。

服务完成只代表本诊断报告交付后的参与方确认；不是自动 Execution/Verification 成功证据。
