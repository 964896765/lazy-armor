# VNext v4.0 第二批：Scenario Contract V2 兼容侧车

## 交付范围

本批建立 `Scenario Contract V2` 的共享类型、完整性校验、只读注册表和 API 查询入口，并仅以 `daily_life.delivery@2` 作为首个金标准场景。V2 通过引用既有不可变 Scenario revision 工作，不修改旧 96 的定义、revision、hash 或数据库记录。

合同明确表达：

- GoalSpec 与 ResourceSubject 的独立运行时校验；
- FactDemand 的事实键、新鲜度、最低 Reality 和允许来源能力；
- ActionDemand 的动作意图、能力、确认要求与验证合同；
- 隐私分类、目的和原始证据保留策略；
- 不支持条件；
- `CATALOG_ONLY → … → PRODUCTION_ELIGIBLE` 治理状态及真实 Source/Action 的分离证据。

## 快递静默管家结论

当前治理状态固定为 `DETERMINISTIC_SANDBOX`：已有确定性 parser/action recipe 代码和测试证据，但本批没有真实物流平台账号验证，也没有新增 Android 真机证据。因此 `realSourceVerified=false`、`realActionVerified=false`，不能提升为 Beta 或 Production。

关键闭环是：绑定明确运单对象 → 获取 `shipment.status` 候选 → 过滤营销/重复/无身份通知 → 形成有证据 Truth → 状态变化或异常时产生通知意图 → 发送记录与业务状态分别核验。提醒发送成功不等于包裹已签收。

## 接口与兼容性

- 新增 `GET /scenarios/:key/contract-v2`。
- 只有已评审的侧车返回 200；现有但未评审的场景返回 404，不从 V1 自动拼装或伪造 V2。
- 旧 `GET /scenarios/:key`、96 场景、8 策略与 15 步执行内核保持原样。
- 测试固定旧 96 目录 hash：`3537c87bf154a5d7d779dbdccf2315d7b54a9dd253a6a390d76a855d51f77905`。

## 后续依赖

下一批应基于此合同完善 FactDemand/Source Resolver 的用户级来源选择，并将 GoalSpec、ResourceSubject 和用户选中的 Offer 持久化到新的不可变计划版本合同。在此之前，17 步投影继续如实把这些缺口显示为 `BLOCKED/SKIPPED`。
