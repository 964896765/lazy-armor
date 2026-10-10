# V89 Skill Ecosystem

2026-10-10 最新后续开发：[V89-SKILL-03 从所选方法开始会话](V89_METHOD_CONVERSATIONS.md)已实现显式版本选择、原会话入口、变化/撤回提示、原 Plan 与一次性操作确认时的冻结引用。独立自动验证与真实第三方/资源组合验收分别记录；下方 V89-SKILL-01/02 为此前检查点。

任务编号：V89-SKILL-01。

目标：接入用户可控、可追溯、不可变版本的方法组件，并让 Planner 在原合同内参考 0～N 个方法。

Backend：扩展原 `portable-skills` 模块，新增 SkillRepository / Entry / Revision，保留原官方 Portable Registry。`skill-repository.v1` 方法包包含 name/description/input/output/requiredCapabilities/permission/risk/verification/version/instruction；严格拒绝执行授权等额外字段。每包最多 12 个方法，UTF-8 120 KB。来源 USER/GITHUB/COMMUNITY 由用户提供，外部来源要求 HTTPS URL，不能自称官方；没有声称已经验证远端作者或自动同步 GitHub。

接口：`/skill-repositories` 支持 owner-only 列表、导入、详情、规划使用开关、移出列表与追加条目版本。导入默认关闭规划参考；相同 owner/request/content 的并发重放保持一个仓库和条目身份，换内容返回冲突。设置用 version CAS。已发布的同一版本内容不能更改，升级追加 Revision，旧 Revision 保留。

Planner：仅检索本人明确启用的仓库，每次最多三个相关方法。内容进入 UNTRUSTED_SOURCE_CONTENT，不替换 SYSTEM_POLICY 或原官方 Skill 指令。Server 记录确切 revision/hash/version 的 methodRefs；模型响应后和最终消息发布事务内两次复核。撤回或更新后旧建议失效；确认 Plan 时再次锁定复核，将引用同事务冻结到原 PlanVersion，失败回滚整份确认。方法声明不提供资源、Credential、工具绑定、降险或执行权，Plan 仍由原 Scenario/Recipe Compiler 和 Runtime 执行。

Frontend：原计划页 Skill仓库占位改为本人仓库列表；“+”接入方法包，选择后预览来源和版本，再导入。详情显示方法说明、声明风险、所需能力、独立启用/关闭；可移出列表。原计划判断依据中显示确认时引用的确切版本，仓库移出后仍保留历史。没有第六个一级页。

Database：追加 `0090_skill_repositories.sql`，仅新增四表 skill_repositories / skill_entries / skill_entry_revisions / plan_skill_references。FK、owner/request 唯一键、entry/version 唯一键及 PlanVersion/revision 唯一键保留。零旧 Truth/Plan/Execution 改表或回填；旧 Plan 可以引用零个方法。迁移仅执行于本轮独立 `_test` 库，没有生产迁移或部署。

Runtime：没有 Skill Engine 或可执行代码加载器。input/output 是声明，instruction 是参考数据；不执行方法包里的 JavaScript、Shell 或工具指令。原 Plan/Resolver/Approval/Invocation/Verification 继续决定实际执行。新表尚未迁移时，Planner 取得零个导入方法，原入口保留；其它数据库错误继续报错，不伪造资源就绪。

Test：并发导入、内容重用冲突、owner/CAS、默认关闭、提示注入隔离、模型请求期间撤回、消息发布前撤回、确认期间撤回及原事务回滚、PlanVersion 固定引用、版本升级和归档历史保留。原 Portable Registry 增强内容冲突与返回值深复制，防止调用者数组修改内部方法。自动化使用隔离 fixture 方法包，不作为真实第三方接入证明。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED / BUILD_VERIFIED，V89 整体 IN_PROGRESS。真人文件选择、第三方来源实际包、真实模型消费、具体资源组合与核实闭环仍 REAL_PENDING；V89-SKILL-02 已提供本人请求的远端预览/导入，自动同步、公共发布与付费能力市场仍未实现。

下一任务：真实第三方包经本人 UI 导入并独立启用，沿原会话→合法 Plan/Task→实际 Resource→Verification 验证；持续保持原始来源和不可变引用。正式市场发布仍需真实服务交付，不展示虚构服务或可执行能力。

V89-SKILL-02：新增 POST /skill-repositories/preview 和 /from-url，前端增加 GitHub/URL 预览导入。仅公开 HTTPS JSON；GitHub 必须固定 40 位 commit 与具体 JSON 文件，记录规范 GitHub 来源。DNS 限时、全量地址检查、TLS 固定解析、无重定向/账号/Cookie，正文上限 120 KB。远端 requestId/sourceType/sourceUrl 不能取得导入身份或官方标签；Server 重新生成来源与内容 hash，导入时再次读取并核对预览 hash，内容变化拒绝。导入默认关闭，已有幂等、owner、版本与冻结引用门继续适用。本轮 transport fixtures 不证明第三方实际包验收，也不提供私有仓库授权/自动同步或 SKILL.md 任意代码执行。
