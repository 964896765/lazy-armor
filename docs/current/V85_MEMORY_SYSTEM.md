# V85 Memory System

任务编号：V85-MEMORY-01 — Controlled Store & Planner Context。

目标：让用户主动保存稳定的个人资料、资产、偏好和经历，后续目标理解可引用这些信息，并且可关闭、编辑、删除和查看来源。

背景：继 V84 Task foundation 后按冻结顺序进入 V85。Memory 与 Conversation Context、USER_EVENT、Plan State、Truth 各自独立。用户声明的个人信息不能冒充现实验证或执行授权。

Backend：新增 `apps/api/src/memory` 的 owner-only Store、Permission、Retrieval/Ranking。默认关闭；开启使用并明确确认后可新增。保存请求幂等，编辑/开关按版本检查。类型 PROFILE/PREFERENCE/ASSET/PERSON/LOCATION/EVENT/DECISION/HISTORY。手动确认来源和时间由服务端写入，客户端不能提交 Truth 来源或置信度。

Frontend：资源页内新增“个人记忆”，提供使用开关、信息分类、列表、确认保存、编辑、删除、来源与时间，两个二级页均有可见返回。关闭使用仍可查看/管理已保存内容。错误与版本冲突用用户语言说明；没有新增一级页。

Database：0087 新增 `personal_memory_settings` / `personal_memories`。个人内容、确认来源/时间、版本、过期时间与独立请求身份持久化。删除清除 title/content，仅保留不可用于检索的幂等/owner tombstone；审计不保存个人正文。编辑过期记录不自动延长有效期。

接口：`GET/PATCH /memory/settings`、分页 `GET /memory`、确认 `POST /memory`、owner-only `GET/PATCH/DELETE /memory/:id`。状态变更与来源审计同事务。没有 AI 直接保存、Truth 写入或自动授权接口。

Runtime：原 Planner 在本人开关允许时从至多 100 条近期有效记录排名取至多 8 条。内容在 `UNTRUSTED_SOURCE_CONTENT` 中按个人数据传给现有模型，metadata 仅含来源/版本 refs；内容每条截断 320 字。模型返回后复查使用开关、设置版本、记忆版本与有效期；途中撤回/编辑的结果拒绝发布。消息与审计保存使用的 memory refs，不保存完整检索上下文。Shared Runtime/审批/Truth 权威不变。

Tests：8 项真实隔离 MySQL 集成覆盖默认关闭/明确确认、并发幂等、owner 隔离、相关检索、内容与系统政策隔离、关闭使用、生成途中撤回、更正与过期、删除清除与不能复活。Planner 消费测试使用明确的隔离模型，不属于真实 AI/手机验收。另有 31 项 Agent Context/理解/Planner 回归与移动端来源/过期/冲突呈现检查。

Acceptance：本人正常登录→开启使用→确认保存设备或偏好→后续真实模型理解引用→关闭/删除后不再引用。真实模型记忆消费与移动端操作在尚未恢复正常登录时保留 REAL_PENDING，不能以构建替代。

完成状态：Store/Permission/Retrieval/Ranking + Frontend 已实现并通过自动化验证；V85 整体 IN_PROGRESS。尚未实现自动 Memory Extractor 候选确认、Memory Relation Graph、来源引用交互与这些功能的真实验收，不宣称完整 Memory OS 已完成。

下一任务：V85-MEMORY-02 — 会话中的 Memory Candidate、受控确认与引用核对，再扩展 owner-bound Relation Graph。V85 后进入 V86 Resource Capability，后续 V87 Computer Runtime / V88 Loop / V89 Skill / V90 Beta 顺序不变。

## 验证与部署记录 · 2026-10-09

- API 39/39 相关回归通过，最终 Memory 集成补跑 8/8；Mobile 4 文件 16/16 通过。
- API/Mobile 类型检查、Database/Plan-schema/API/Web build 与 Android bundle/APK build 通过，88 个迁移分段检查通过。
- 0086/0087 已执行于隔离测试库与本地开发库。既有全库 migration:safety 因历史 0083 缺 destructive release evidence 仍失败；未修改历史迁移或放宽 gate，不声称 production release gate 已过。
- 在 Execution 与 Outbox 活跃租约均为 0 时更新本地三角色，API 3001、Execution Worker 3011、Outbox Worker 3012 均 200/ready。匿名访问新增 Memory/Task 接口均 401。
- Task/Memory r1 APK 已覆盖安装在 `2c696fe`，源码 bundle、APK 内 bundle 与已安装 APK 字节身份核对通过。APK SHA256：`fd4fbf696947b35758d2ec804b3c4ef812f482fb1d5cc57045c5b4a04dd11dce`。
- 未插入生产 Memory/Task fixture，未替用户开启 Memory。构建安装不等于手机点按、真实模型消费或 V85 CLOSED。

本机证据：`artifacts/v85-memory-final-regression.log`、`v85-memory-r1-install-real.json`、`v85-memory-service-deployment-r1.json`、`v85-memory-runtime-readiness-r2.json`。启动初期未 ready 的 r1 文件保留。新本机 artifacts 不上传 GitHub。
