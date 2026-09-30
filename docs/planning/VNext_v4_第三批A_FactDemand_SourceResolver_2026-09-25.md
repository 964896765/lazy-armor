# VNext v4.0 第三批 A：FactDemand 与用户级 Source Resolver

## 交付

- 扩充 Scenario Contract V2 的 FactDemand：对象类型、允许 SourceMode、最低 Reality、TTL、刷新、验证、冲突和缺失策略。
- 新增严格运行时请求合同；客户端只能提交场景版本、GoalSpec 和 ResourceSubject，不能指定任意 factKey。
- 新增 `POST /api/runtime/fact-demands/resolve`，从当前用户实际 Provider capability、连接授权、Provider health、可信设备、App 授权、30 秒设备心跳及精确 Subject Truth 生成只读投影。
- 多候选来源按确定性规则排序并保留理由/证据；排序只选择采集路线，不把来源优先级当成 Truth。
- 明确分离 capability discovered、user owns source、source usable、data acquired、data verified 五个维度。
- 数据冲突保持 `CONFLICT` 并交还既有 Reality/Truth policy，不由 AI 选择事实值。

## 金标准范围

`daily_life.delivery@2` 支持已登记 `READ_SHIPMENT` 的 Provider 路线，以及真实用户拥有的菜鸟/顺丰设备 App 通知路线。只有已启用 `notification_read`、可信设备有效且心跳在线时，设备路线才可用。通知路线仍是候选获取渠道；只有精确匹配 `subjectKey` 的 Observation → Candidate → Truth 才表示实际取得并验证数据。

## 自动化证据

- 共享合同覆盖非法对象、非法 Goal、非法 revision、客户端注入 factKey、缺授权、设备离线、Provider 不健康、未实现来源、过期事实、待验证事实、相同重复事实、多来源冲突和未登记能力。
- MySQL 集成覆盖鉴权、跨用户来源/Truth 隔离、在线设备来源发现、Reality Pipeline 形成精确 Subject Truth、授权撤销和设备离线。

本批使用确定性测试设备/数据，不等于真实菜鸟或顺丰平台验收；场景治理状态仍为 `DETERMINISTIC_SANDBOX`，真实平台与 Android 真机状态为 `EXTERNAL_ACCEPTANCE_PENDING`。

## 下一项

持久化 GoalSpec、ResourceSubject、FactDemand snapshot、Source selection 与用户确认的 Plan Offer；选择时重新解析当前证据并以事务创建兼容 Plan/PlanVersion，提供幂等与并发保护。
