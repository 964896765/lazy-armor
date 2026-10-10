# V89-SKILL-06 · 多方法组合选择入口

目标：让本人在原方法仓库中选择一至三个方法，明确参考顺序与版本，沿原临时会话表达目标，再选择一次处理或设为计划。

Backend：复用现有 owner-only 仓库分页/详情和 `POST /conversations`，无新增 API、Controller 或服务端执行路径。原创建事务继续锁定复核全部 methodRefs 的 owner、仓库 version、启用/归档、Entry、Revision 与内容 hash；任意一个失效则整份创建失败，不能只接受剩余方法或替换为最新版本。原 Planner、Plan/一次性确认冻结与资源核对合同保持。

Frontend：仓库列表增加“组合方法开始会话”，详情增加“选择多个方法”，接入二级选择页。支持同仓库/跨仓库、同名不同身份的方法；最多三个、每条 Entry 仅一次，保持选择顺序并支持上移/下移/移除。选择时复制所见方法声明与确切引用，不自动启用仓库。显示原版本、声明风险、所需能力，以及核对中/当前/变化/不可用状态；变化需移除后本人重新选择，不随刷新悄悄更新。

提交：先固定严格引用 payload，再按不同仓库分别刷新本人详情，全部仍 CURRENT 才调用原创建 API。提交只包含 mode/title/methodRefs，不传方法内容、权限、Credential 或风险覆盖。客户端核对后的竞态仍由原服务端事务拒绝。创建 mutation 不自动重试；失败保留选择供核对，成功进入原会话继续输入 Goal。选择页按账号隔离本地状态，离开/账号变化后的异步回调不自动跳转，刷新结束后提交前再次核对当前账号与页面。

Database：零 SQL 迁移、零新表、零共享 Schema 改动、零回填。选择在本页内暂存，正式上下文仍由原 consumer_conversations.context_refs 与不可变方法表保存。

Runtime：组合顺序只表示规划参考顺序，不定义新的执行流程。选择/刷新仓库不调用模型或资源，创建会话只保存原上下文和原选择审计，不创建 Plan/Execution/Invocation/Truth。实际目标、资源范围、风险、审批、Task、Verification 和 Truth 继续各自沿原权威；方法声明不能自动授权或降险。

Test：新 Mobile 专项 13/13，验证同仓库/跨仓库与同名身份、排序移除后 payload、重复/上限、关闭/移出、声明快照不随缓存改变、版本/hash 变化、严格只发引用、去重刷新、任一读取失败阻止创建、异步期间引用固定和服务端冲突不被吞掉。新隔离 API 专项 8/8 直接调用同一 Mobile 选择/提交辅助函数，通过真实隔离 HTTP 仓库/会话验证三方法顺序、非可信输入隔离、原资源核对分组、客户端与服务端两处失效拒绝、提升/正式 Plan 的全部冻结引用和撤回后的确认事务回滚。隔离夹具不代表真实模型或第三方资源验收。

最终验证：API 4 文件 47/47，包含原方法会话/一次性审批、资源核对与 Revision 管理；Mobile 全套 65 文件 412/412、Plan-schema 全套 46 文件 251/251、八包 typecheck、API/Web 构建与 Android Hermes export 通过。新专项已包含在各自回归内，不重复累计。

本机证据：

- `artifacts/v89-method-selection-api-regression-r1.log`
- `artifacts/v89-method-selection-mobile-tests-r1.log`
- `artifacts/v89-method-selection-schema-tests.log`
- `artifacts/v89-method-selection-typecheck-r1.log`
- `artifacts/v89-method-selection-api-build.log`
- `artifacts/v89-method-selection-web-build.log`
- `artifacts/v89-method-selection-android-build.log`

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED。API 仅在 `lazy_armor_v88_v89_20261010_test` / Redis DB 15 与每轮独立 prefix 中运行，没有执行共享容器重启故障注入或全套 API。原有 12 个登录/设备 Runner 文件 SHA256 不变，留在工作区并排除本次提交；沿用户已有授权推送当前 codex 分支。历史 0083 release evidence 门保留；本轮没有生产迁移、当前服务部署或 APK 安装。本人 UI、实际第三方包/模型/资源组合、真机/网站、V88 七天和 V90 五页现实闭环仍 REAL_PENDING，V89/V90 不提前 CLOSED。

下一任务：V90-BETA-02 五页联合验收与实际资源闭环证据收口，沿原本人入口、许可、合法确认、实际调用与 Verification；真实证据和迁移发布门分别满足后再关闭阶段。
