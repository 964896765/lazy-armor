# 懒人装甲开发任务

## 当前优先级

1. 完成 12 领域、8 PlanMode 和 PlanTemplate 数据迁移，保持历史 PlanVersion 不变。
2. 建立统一 Resource API，聚合 Connection、Device、Data、MCP、Skill、Cloud 与 Service。
3. 建立 ServiceProvider 与 ServiceOffering 数据模型和真实服务详情页。
4. 建立 Conversation、Message、Attachment、Context Item 与聊天进度事件。
5. 把旧聊天、模板和待处理兼容路由调用降为零后删除兼容层。
6. 完成账目整理、快递跟进、每日重要事项、设备耗材、家庭补给五条真实闭环。
7. 恢复完整数据库、Android、备份恢复、依赖审计和发布门禁。

## 每项完成要求

- 页面必须覆盖 loading、empty、error、offline、权限撤销和恢复。
- 状态必须来自真实 API 与权威数据库，不使用 production fixture fallback。
- 外部副作用必须增加幂等、审批、验证、reconciliation 与 `OUTCOME_UNKNOWN` 测试。
- 资源可用性必须覆盖 revoke、offline、stale 和 degraded。
- 任何 Production 声明必须附带真实设备或真实 Provider 证据、回滚方案与可观测指标。
