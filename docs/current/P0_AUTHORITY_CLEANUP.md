# P0 去权威化清单（2026-10-07）

以 V83_MAINLINE.md 为当前主计划。本清单区分已改入口与待迁合同，避免简单更名造成虚假 Skill 能力。

| 层 | 当前处理 | 后续要求 |
| --- | --- | --- |
| 计划主页 | Skill仓库 / 我的计划；默认我的计划；新建进入 chat?mode=plan；移除主页旧模板目录及 productTemplateKey 传参 | Skill仓库目前明确待接入；P6 接真实 Registry，不能从模板生成虚构 Skill |
| 我的计划 | 保留全部/运行中/待处理/已暂停/已结束筛选与已有详情 | 保留历史 PlanVersion，不删除 template 引用 |
| 会话 authoring | 已有自然语言计划入口，用户无需先选择领域/场景/模板 | 继续 lawful CreationDraft 确认；Recipe/scenario 合同暂保留内部验证 |
| legacy GoalResourceSelector / create-wizard | GoalResourceSelector 保留兼容；/create 与 /create-wizard 已 redirect 到自然语言计划会话 | 不作为先选场景的新产品创建路径 |
| Plan 编辑 | 非模板计划当前仍缺通用编辑器 | 后续补合法新版本 authoring；不能通过去掉校验伪装支持 |
| 分类 | 当前 API/共享目录仍有 PRODUCT_DOMAINS 等固定定义 | 分离可扩展 category/tag 与 Legacy 映射，逐个迁移；kind/domain 不混用 |
| Skill 权威 | 未正式建立 Definition/不可变 Version/冻结引用 | P6 正式实现及迁资产，GitHub 内容先分析再候选，不直接执行 |
| Strategy / Scenario / Template | 旧运行合同保留 | 用户选择入口退出；受控执行语义不能因 UI 改名失去约束 |

## Phase 1 CLOSED（2026-10-07）

全仓残留搜索保存于 artifacts/v83-p0-full-repository-audit.txt，专项搜索保存于 artifacts/v83-p0-dependency-audit.txt。主入口不再消费旧目录；Consumer 旧 catalog、历史模板/场景路由和 Plan 编辑仍保留兼容；CreationDraft 中 scenario 是受控合同 metadata，不要求用户先选场景。正式 category/Skill 迁资产留 P6，不宣称本阶段完成。

docs/current PRODUCT、ARCHITECTURE、STATUS、TASK_BOOK 现行口径已统一到 V83_MAINLINE。旧阶段记录保留历史。

全仓 typecheck 8/8、mobile 完整回归 56 文件/340 项通过。最终 dev=false bundle 与 Debug APK 构建并安装到真实 23049RAD8C；SHA256 7757C14E454A2B40373218ACF583F2EE0A804659D4CBD6A83A735E46651903E4。首次 bundle 包含 devtools 导致启动失败，错误截图/日志保留，重打包安装后通过。

真机核对：Skill仓库明确待接入；我的计划横向筛选保留；+ 进入计划会话并可恢复 CreationDraft；自然语言经实际 UI 发送与真实模型产生 PLAN_DRAFT，conversation=01a114e8-00de-7634-a0aa-a4188954ddba，draft=01a114e8-00e2-725c-890f-6e6a4181ebd5，未确认成 Plan、未调度写入。手机 IME 曾改变注入文本，最终采用现有受支持 intent 参数预填自然语言、实际点击发送；未调用直接生成 API。完整记录见 artifacts/v83-p0-real-draft.json 与真机 XML/PNG。

旧真实 Plan 01a11433-ffe6-7758-8fb8-ef92cfe29edd 仍可在 App 打开；前后 GET 快照确认 current/active version 与当前定义 hash 未变（v83-p0-authority-before/after.json）。P0 Phase 1 关闭，P6 迁资产未开始，P1 overall 仍待故障矩阵。
