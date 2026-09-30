# Mobile V5 前端落地边界

V5 的 Space → Scenario → Plan 是导航与解释层，不改变既有 Runtime。Space 不建新表，不作为 Plan/Truth/Execution 的权威状态；Scenario 仍使用现有版本化目录与 readiness API，Plan 仍使用现有计划和执行主链。

## 当前切片

- 左侧导航栏提供“空间”入口；移动端打开抽屉，在四个现有 Domain Group 中浏览全部 19 个领域与 96 个场景。点领域进入现有领域页，再进入场景详情和实时 readiness；点计划进入现有计划页。
- “我的成长”在 V5 文案中是未来扩展，但当前目录没有对应领域，故只显示“尚未开放”，不显示虚构场景、计划或运行状态。
- 抽屉只使用共享目录定义。它不判断用户授权、Provider 健康、Truth 是否新鲜，也不产生 `READY` 状态。场景详情继续读取 `/api/scenarios/:key`、`/api/scenarios/:key/readiness` 和 `/api/scenario-coverage-ledger/:key/runtime-evidence`。
- 现有左侧导航栏已是侧边导航而非底部 Tab；本切片不更换 Expo Router 的内部 Tabs 实现，避免为视觉结构复制一套导航状态机。

## V5 草案与当前 API 的区别

文档中的 `/api/v1/spaces`、`/api/v1/plans` 等路径是目标设计，不是当前已实现的 API Contract。Mobile 当前通用客户端在路径前加 `/api`，并使用既有 `/plans`、`/connections` 等接口。未经服务端真实契约与迁移，不在客户端假设 `/v1` 已存在，也不提交“自动可用”之类的状态。

下一步页面收敛按真实数据依次完成：场景的关联计划投影、计划与执行的解释型摘要、Truth provenance、Connection 四维能力矩阵，以及 Today/Records 的可追溯记录。若后端缺投影，页面显示空态/未达到，不以 fixture 补齐。
