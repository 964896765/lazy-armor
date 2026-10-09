# V85 Memory Candidate / Reference / Graph

任务编号：V85-MEMORY-02 / V85-MEMORY-03。

目标：会话里的稳定个人信息可以形成建议，用户核对后进入同一 Memory Store；关联个人信息可以辅助后续目标理解，来源、版本、撤回和发布边界保持可追踪。

背景：接续 V85-MEMORY-01，不修改已有 Plan/USER_EVENT/Runtime/Truth 权威。2026-10-09 用户明确要求继续本地开发、暂不推送，本轮仅保存本地 checkpoint。

Backend：现有模型合同增加可选 `memorySuggestions`，只允许使用当前用户输入中逐字存在的 quote，最多 3 项；缺授权、非法类型/字段、编造引用、重复 quote 均不进入候选。附件、历史会话、模型解释和外部观察不能充当本轮来源。Planner 校验通过后，候选与对应 assistant message 同事务绑定实际 user message/request、来源 hash、建议 hash、模型与 settingsVersion。会话 JSON 不保存原始候选副本。

候选确认与忽略独立于原 Goal 生命周期：确认前不进入长期 Memory。owner-only 复核允许用户更正标题/内容；确认使用现有 MemoryService，同事务冻结 Memory v1 与确认 hash，重放只返回同一身份/当时版本。改变重放内容被拒绝。确认、忽略或关闭记忆后清除待核对内容副本，保留身份/来源/状态/hash；重新开启不复活旧候选。来源改变或删除阻止尚未确认的候选保存。

Reference：历史回答保存 Memory/Relation 的 id/version refs。引用页区分当前、更正、删除、过期、关闭使用；已改信息只展示最新数据并明确说明，不冒充旧版本内容。来源页查 owner 所有原会话，并比对已确认候选的来源 hash；原消息改变/会话删除时不展示错误来源。删除 Memory 不改历史消息，不删除用户仍保留的原会话声明，两者生命周期独立。

Graph：关联枚举 OWNS/USES/PREFERS/RELATED_TO，由用户明确确认两条自己已保存且未过期的信息。关系冻结 from/to 版本、weight=1 和请求身份；不允许 AI 自动加边、跨用户端点、旧版本或自行授予风险权。相同请求重放只有一个关系，移除后显式新确认产生新 id。端点编辑/删除同事务撤回相关边，旧记录不复活。

Frontend：会话里的“个人记忆建议”进入核对页；AI 回答可打开引用信息；个人信息详情进入来源与关联页。核对、忽略、编辑、删除、关联确认/移除都有实际后端入口。新增页使用 EditorPage 可见返回，一级页面仍为日程 | 计划 | 会话 | 资源 | 服务。

Database：0088 新增 `memory_candidates` 与 personal_memories 的 nullable source_ref_json；0089 新增 `memory_relations`。迁移只追加，没有修改 0087 或历史权威表。来源审计仅记录 id/version/hash/状态，不复制个人正文。

Runtime：在 100 条近期有效本人 Memory 中选至多 6 条相关信息，再沿当前有效关系最多一跳补齐到 8 条，读取关系上限 40。个人内容和关系放在 UNTRUSTED_SOURCE_CONTENT；metadata 仅放 refs，不成为 Truth 或执行指令。检索范围有明确上限，不宣称全量知识图谱推理。

模型生成后复查 settings/Memory/Relation 版本；Consumer 保存最终回答的事务再次锁定 settings 与引用版本，阻止“生成后、消息保存前”的撤回或更正发布旧答案。原用户需求继续保留，拒绝分支恢复会话 ACTIVE，不伪造完成。Memory/Graph 不直接写 Truth、审批、Invocation 或 Execution。

Test：8 文件 63/63 API 回归通过，含候选、Graph、Store、来源核对、Planner/Context 和内部事项规划。专项覆盖并发确认、实际 user-message 来源、来源篡改/删除、候选失效、旧引用、关系重确认、端点更正/过期/删除、模型完成中撤回与最终消息提交前更正。测试使用隔离 `_test` MySQL、Redis database 15 与明确标识的隔离模型，不是手机或真实 AI 证据。Mobile 来源/引用与既有页面合同检查 14/14，类型检查和最终构建另记。

Acceptance：正常登录→会话输入个人陈述→真实模型建议→用户核对/确认→Memory→建立关联→后续目标消费→查看来源→更正/关闭/删除后拒绝旧引用。尚未取得手机与真实模型连续闭环，V85 保持 IN_PROGRESS，不因自动回归提前 CLOSED。

完成状态：IMPLEMENTED / AUTOMATION_VERIFIED，最终本地构建/部署/安装记录追加到下方。

下一任务：V85-MEMORY-04 真实模型/产品闭环与用户控制验收。接下来才按冻结顺序进入 V86 Resource Capability；不增加新的 P3/Calendar 验收，也不提前 Computer Use。

## 本地部署与安装 · 2026-10-09

0088/0089 已执行于隔离测试库与本地开发库，迁移分段检查 90 文件通过。全库 migration:safety 仍受历史 0083 缺少 destructive release evidence 阻塞；未改历史迁移或绕过 gate，不标记生产发布通过。

API/Mobile typecheck、Database/Plan-schema/API/Web build、Android bundle/APK build 已通过。API 8 文件 63/63、Mobile 14/14 通过；最终来源 hash/审计修改后候选专项 7/7 通过。并行构建期间一次 Nest 初始化超时记录保留，结束构建后原断言重跑通过，未放宽超时或断言。

Execution/Outbox 活跃租约均为 0 后更新本地三个角色，API 3001、Execution Worker 3011、Outbox Worker 3012 均 200/ready。本次只读核对开发库：Memory=0、Candidate=0、Relation=0、enabled users=0；没有替本人开启使用或制造生产信息。

r2 APK 已覆盖安装在 `2c696fe`，APK 内 bundle 与源码 bundle 一致，手机安装包 SHA256 与构建包一致：`8a4278956ab4e7cfc6b593b10d8c6aab0d4fa7b55d234d0bbca5b04da4a97c05`。保留应用数据、正常登录入口和开发 API 转发。

真实 DeepSeek 只读 extraction/schema probe 8 项通过，使用明确虚构的个人陈述与合成开启上下文，保存对象数为 0；这不是本人记忆授权、确认、消费或手机 Golden Flow。正常登录暂不可用，相关 UI 验收保持 REAL_PENDING。

本机证据：`artifacts/v85-memory-composition-final-tests.log`、`v85-memory-candidates-r3-tests.log`、`v85-memory-composition-deployment-r2.json`、`v85-memory-composition-readiness-r2.json`、`v85-memory-composition-authority-counts-r2.json`、`v85-memory-composition-r2-install-real.json`、`v85-memory-model-contract-r1.json`。本轮仅本地保存，不推送 GitHub；V85 仍 IN_PROGRESS。

## V85-MEMORY-04 · 真实模型与隔离 API 生命周期

新增显式 opt-in 的 `memory-real-model.integration.spec.ts`，默认回归不调用付费模型。启用验收必须使用 `_test` MySQL、Redis 15、已启用的开发 DeepSeek 配置和新的证据文件；账户经正常注册/鉴权接口创建，记录均为明确虚构的开发样例，不访问手机登录或本人账户。

真实 DeepSeek 五次请求贯穿实际 Conversation/Planner/Memory API：候选仍待核对→本人测试账户确认并重放同一身份→确认资料与关系被真实模型引用→编辑后消费 v2、旧引用仍标记 CHANGED、旧关系撤回→关闭使用后不发送 Memory 内容/引用→删除后清除正文、跨 owner 拒绝、0 Truth/Execution。5/5 通过，未覆盖用户手机核对、真实个人授权和实际生活目标；这些继续 REAL_PENDING。

证据：`artifacts/v85-memory-real-api-r2.json`、`v85-memory-real-api-r2.log`。首次 runner 缺 Vitest CLI 路径的失败日志保留，改用已安装的 pnpm exec 后执行通过。源码 API typecheck 通过。本地 checkpoint `316ec96` 已保存候选/引用/关系实现，无 push。

V85 后端/前端基础与真实模型 API 验证具备，手机验收独立保留；按用户连续开发要求进入 V86 的已有 Registry/Resolver 资源能力投影，不提前 V87，也不把 V85 标记 CLOSED。
