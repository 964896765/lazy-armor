# 懒人装甲当前状态

更新日期 2026 10 01

## 已完成

- 五个一级导航已固定为首页、计划、问一问、资源、服务。
- 首页改为真实 Today、Attention、Plan Template 数据投影。
- 计划页同时提供计划模板发现和已有计划管理。
- 问一问使用 `/chat/plan`，不暴露多助手模式。
- 资源页展示真实连接和设备状态，并提供数据、能力、授权二级入口。
- 服务页已移除静态服务卡，不再把未接入供给描述为可用服务。
- 新增 `/plan-templates`、`/chat/plan`、`/attention` 兼容收敛入口。
- 新增当前术语门禁。
- Next.js Critical 和 brace-expansion High 依赖漏洞已升级处理；生产审计剩余 Moderate。
- 全仓 TypeScript 检查通过；移动端测试 264 项通过。

## 尚未达到生产完成

- 统一 Resource API 与 ServiceOffering 持久化模型尚未完成。
- Conversation DB、附件对象存储、SSE 进度和 Context Memory 尚未完成。
- 12 领域和 8 PlanMode 的数据库迁移、旧模板映射与多对多关系尚未完成。
- 五条 Golden Plan 仍需要真实设备、真实账号和真实 Provider 证据。
- Android release、完整数据库集成、14 天以上 Staging soak、备份恢复演练和生产放量尚未完成。
- main branch protection 需要在 GitHub 仓库配置。

不得把代码完成或合同测试描述为真实 Provider、真实设备或 Production Ready。
