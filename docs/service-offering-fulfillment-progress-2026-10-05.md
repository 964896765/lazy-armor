# ServiceOffering 发布与编辑整改 — 2026-10-05

已实现并安装真机 APK。Plan / Resource / ExternalReference 主链、kind/domain 和 SERVICE 投影保持原有设计。

- 统一五种服务方式 ONSITE / AT_LOCATION / REMOTE / LOGISTICS / OTHER；寄送/物流不作为服务类型或领域。单选同时持久化 deliveryModes 数组，为未来多选留位。
- 发布和编辑复用轻量表单，按基础信息、服务信息、交付信息、价格、联系与预约、发布组织。serviceType、统一13领域 domain 和 deliveryMode 独立；领域 Tab 只筛选 domain。
- 根据方式展示对应字段，后端清除无关字段并验证必填项；OTHER 必须明确说明。
- FIXED / STARTING_FROM 要求金额；NEGOTIABLE / FREE 不接受金额。旧客户端未提交价格时保留已有价格。
- 0075 迁移已应用业务库和隔离测试库：LOCAL→ONSITE，REMOTE 保留并转移说明，未知方式不推断；旧零金额仍为 STARTING_FROM，不猜成 FREE。

验证：API相关3文件23测试、Mobile 52文件303测试、Schema 34文件189测试通过；API构建及Mobile/Schema类型检查通过。隔离测试覆盖五种模式持久化与幂等、非法字段/金额拒绝、切换字段清理、所有权、并发版本、临时旧表迁移。

真机：新版 APK 安装成功；发布页13领域、五种交付字段及四种价格显隐已观察并保存 XML/PNG。截图位于 artifacts/android/v8-productization/service-offering-*.png。仅操作未保存的空白表单，未在业务库创建伪造服务。真实公开发布/真实服务编辑提交未作为本次真机证据；后端提交已在隔离库验证。

构建、安装哈希和验收记录：artifacts/service-offering-build-evidence-20261005.json。
现有真实库迁移只读记录：artifacts/service-offering-migration-evidence-20261005.json。
测试日志：artifacts/service-offering-{api,mobile,schema}-tests-20261005.log。
