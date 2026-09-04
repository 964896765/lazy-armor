# 懒人装甲任务书

## 当前不可违反的架构约束

本任务书中的约束适用于所有生产代码、迁移、接口、移动端页面、自动化和后续提交。任何功能开发均不得以快捷 Demo、Fixture 或特定品牌适配为由绕过它们。

> **核心原则：真实设备发现 → Generic App Connection → 可选 Enhanced Adapter。** Provider 或 App 的名称只能出现在 Connector、Adapter、Catalog 和明确的展示映射层；不得作为核心业务模型、计划定义、资源语义、流程分支或生产 UI 的硬编码前提。

| 规则 | 必须做到 | 明确禁止 |
|---|---|---|
| 通用 App 接入 | 用户设备上真实已安装、可启动的 App 都可在用户确认后建立 `Generic App Connection`，并具有基础的真实展示与用户主动打开能力；接收用户分享内容是后续独立交付项，未实现前不得宣称可用。 | 因某 App 未命中专属目录而拒绝整个连接；在客户端静态列出几个品牌作为用户的“已安装应用”。 |
| Enhanced Adapter | Catalog 仅声明匹配条件、专属适配器、经审查的额外能力、深链和解析器；命中时增强 Generic Connection，而非授予创建资格。 | 将 Catalog 当作允许连接的白名单；以品牌名作为领域资源或 Plan Requirement。 |
| 设备真实性 | Android 发现结果必须来自系统 PackageManager 的真实 `packageName`、`displayName`、图标、版本和可启动状态；连接记录保留真实发现证据/可信设备上下文。 | 由服务端补造应用名称、图标、版本或安装状态；将测试列表写入生产页面。 |
| 通知来源 | 用户可对任意已添加 App 单独选择是否允许其通知成为来源。来源事件在端侧经 Generic Parser / Classifier / Normalizer 后，服务端仅接收无原文的最小化候选收据。 | `if packageName == 某品牌` 作为核心解析分支；默认读取所有通知；用 Accessibility 泛化为任意 App 自动操作。 |
| 可信设备 | 创建或启用数据来源的 Generic Connection 必须绑定当前账号、当前安装、未撤销的密钥证明设备。私钥必须保留在 Android Keystore，服务端只接受一次性挑战的签名、公钥与指纹。 | 把可复制安装 ID 当作高信任凭据；收集硬件序列号；未验证设备上传来源事件；将当前 `key_proven` 表述为硬件级证明。 |
| 候选与验证 | Parser / Classifier / Normalizer 的输出永远是 `received_unclassified` 候选。候选只有在用户的显式确认和服务端语义一致性校验后，才可成为可消费的资源事实。 | 将金额、类别、账号、订单或其他候选字段直接视为账单/订单/车辆/家庭事实；因收到通知触发外部操作。 |
| Truth Store | 事实必须使用品牌中立 `resourceKey`、来源收据绑定、验证方法、证据哈希、当前版本引用和不可变 `valueHash` 保存。Plan Engine 只能读取 `verified` 事实版本。 | 在计划上下文中读取通知原文、未确认候选、Provider 名称、包名或 Adapter 专属字段；覆盖历史 PlanVersion/DefinitionHash。 |
| 资源语义 | Plan 只描述品牌中立的语义资源，例如 `mobile.billing.current_month`、`vehicle.odometer`、`home.temperature`。Resolver 从用户的已授权来源中选择候选数据。 | 在 Plan 中写 `某运营商品牌.账单`、`某品牌订单` 等品牌资源；将特定 Provider 视为唯一来源。 |
| 生产数据真实性 | 生产 UI 的应用列表、连接状态、账单、车辆、家庭、设备、订单、执行结果均来自真实 Device、Provider、API 或用户输入数据。无数据时显示诚实 Empty State 和连接/录入入口。 | `mockData`、Fixture fallback、示例金额、示例电量、示例里程或示例订单填充生产 UI。Fixture/Mock 仅用于测试与显式 Demo 环境，且须有可审查的环境开关。 |
| 高风险操作 | 支付、转账、下单、账户权限变更等仍须遵守既有审批、验证、审计和未知结果不盲重试规则。 | 因已连接一个 App 就静默授予读取、支付、下单或账户修改能力。 |

## 移动端实现顺序

第一步是从真实系统发现建立 Generic App Connection，并使左侧 Rail 仅由该用户已确认、仍启用的连接驱动。第二步是在用户逐项授权后把通知作为通用来源收集；原始内容只在端侧最小化处理，服务端保留脱敏、限长、可去重的证据。第三步才可添加 Adapter 的解析器和 Provider API，且解析结果必须回落到品牌中立的领域资源。任何 Provider 专属闭环都不得抢在上述通用通路之前成为产品前提。

## 验收门槛

| 验收项目 | 通过条件 |
|---|---|
| 无专属 App 的连接 | 设备发现一个 Catalog 未命中的真实可启动 App 后，用户仍可创建、查看、启用/停用和打开 Generic Connection。 |
| Rail 真实性 | Rail 不预置任何 App；它仅展示当前登录用户、当前数据源返回的已启用连接。 |
| 数据空态 | 断开来源或清空真实记录后，账单、车辆、家庭、设备、订单与执行页面不显示虚构数值，而显示 Empty State。 |
| 通知授权 | 没有系统通知访问或用户未为该 App 启用来源时，不采集、不上传、不解析任何通知。 |
| 候选到事实 | 未知或语义不完整候选不能确认；用户拒绝候选时不产生 Truth Store 记录；确认后的事实必须保留版本、验证方式与最小证据哈希。 |
| 可信设备撤销 | 撤销设备后，所有绑定的 Generic Connection 与通知读取必须立即停用，后续来源收据必须失败关闭并记录审计。 |
| Provider 解耦 | 新增或移除一个 Adapter 不改变 Plan 的资源语义、Generic Connection 的创建权限或未命中 App 的基础能力。 |
| 审计与可观测性 | 连接创建、授权变更、事件接收、拒绝、去重、解析/验证状态均可审计；指标不得带用户、通知正文、包名之外的高基数隐私数据。 |

## 变更控制

此规则由用户于 **2026-09-04** 确认。今后如有实现与本任务书冲突，应优先修正实现并更新测试，不得以“已有 Demo”“已有 Fixture”或“某 Provider 已接入”为例外理由。P0～P5 的历史 `PlanVersion`、`Definition`、`DefinitionHash` 和现有安全门槛不因本任务书改变而重写。
