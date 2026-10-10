# V89-SKILL-05 · 方法版本更新与历史

目标：从既有方法仓库管理同一方法的版本，先核对本人提供的新内容再追加，保留旧内容、旧会话与已确认计划依据。

Backend：新增 owner-only `GET /skill-repositories/:id/entries/:entryId/revisions`，复用现有 Repository/Entry/Revision 表。在同一只读事务取得仓库状态、当前 Revision 与历史；按 createdAt/id 降序分页，默认 10、最多 20，拒绝非法游标、额外查询字段、零/负数/小数与超上限。仓库列表共享 DTO 同步修正整数与下限校验。逐条复核严格 Manifest、内容 hash、版本与方法名，不把损坏历史投影为有效内容。已移出仓库的本人历史仍可读，其他用户和错误仓库/条目组合返回 404。

更新继续使用既有 `POST /skill-repositories/:id/entries/:entryId/revisions`：同仓库锁与 version CAS、同名条目、不可变版本、当前相同内容重放、已被替代版本拒绝重放、原审计均保留。本轮补齐单 Manifest 的 UTF-8 120 KB 上限；不增加另一条更新引擎或回滚接口。规划启用状态不被更新修改。

Frontend：方法仓库增加“管理方法版本”，二级页展示当前版本和分页历史；本人选择单个声明或原格式方法包 JSON 后，只预览同名方法。预览固定原仓库版本和 Revision，说明内容、能力、权限、风险、核实方式、输入/输出等变化；按原 API 明确追加。仓库/版本变化要求重新预览，响应丢失后刷新发现已保存内容时不重复更新。选择文件与提交回调隔离账号/路由变化；返回仓库重新读取当前状态。历史没有覆盖/恢复按钮，五个一级页保持不变。

来源：本轮是本人提供文件的更新入口，仓库来源仍是最初导入声明；界面明确说明更新内容没有因此取得原作者验证。没有远端自动同步、作者签名验证或公开市场发布。

Database：零 SQL 迁移、零新表、零回填。仅扩展共享 TypeScript 的 SkillRevisionHistory 投影，复用既有 0090 表与不可变引用。

Runtime：历史读取不创建 Plan/Execution/Invocation/RuntimeTarget/Truth/审计记录。追加只改当前方法 Revision 与仓库 version，并写原更新审计；旧会话保留原引用并显示 CHANGED，旧 PlanVersion 的冻结引用不改。方法继续作为非可信规划参考，更新不授予资源权限、降低实际风险或启动执行。

Test：新隔离 API 专项 14/14，验证 owner/归档/严格分页、同时间戳无遗漏分页、损坏历史拒绝、原始内容保留、关闭/启用状态保留、CAS 冲突、不同版本并发只有一个成功、相同内容并发只追加一次、过期重放不能恢复历史、超限/额外授权字段拒绝，以及正常更新后 Plan 冻结/会话变化。最终关联 API 4 文件 46/46，包含原仓库、方法会话/一次性审批与方法资源核对。Mobile 新预览边界专项 11/11，全套 64 文件 399/399；Plan-schema 全套 46 文件 251/251、八包 typecheck、API/Web 构建和 Android Hermes export 通过。专项包含在各自全套/回归内，不重复累计。

本机证据：

- `artifacts/v89-skill-revisions-api-regression-final.log`
- `artifacts/v89-skill-revisions-mobile-tests-r1.log`
- `artifacts/v89-skill-revisions-schema-tests.log`
- `artifacts/v89-skill-revisions-typecheck-final.log`
- `artifacts/v89-skill-revisions-api-build-final.log`
- `artifacts/v89-skill-revisions-web-build.log`
- `artifacts/v89-skill-revisions-android-build.log`

首轮失败保留：API 45/46，`limit=0` 意外返回 200；原分页子类只重声明 Max，没有完整整数/下限约束。已在该 DTO 明确声明 IsOptional/Type/IsInt/Min/Max，加入边界及原仓库列表回归，最终同组 46/46。日志 `artifacts/v89-skill-revisions-api-regression-r1.log` 保留，没有删除失败证据或放宽断言。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED。全部 API 在原隔离 `lazy_armor_v88_v89_20261010_test`、Redis DB 15 和每轮独立 prefix 中运行，没有执行会重启共享容器的全套 API。12 个独立登录/设备 Runner 文件 SHA256 不变，继续保留工作区且不纳入本轮提交；按用户已有授权推送当前 codex 分支。历史 0083 release evidence 门保留，本轮没有生产迁移、当前服务部署或 APK 安装。本人真实文件选择与第三方方法/模型/资源闭环、V88 七天、V90 五页现实证据仍 REAL_PENDING；V89/V90 整体 IN_PROGRESS。

下一任务：V89-SKILL-06 多方法组合选择入口，沿已有最多三个、按序且版本固定的 methodRefs 接回原会话；实际第三方与资源组合验收继续独立收取。
