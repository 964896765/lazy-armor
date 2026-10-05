# V8.1 Evidence Ledger — 2026-10-05

延续既有 V8.1 开发与验收记录，不重做已完成文件/服务/空日历证据。日期以 Asia/Shanghai 为准。隔离测试数据仅用于回归，不冒充真实手机证据。

## 会话历史整改

- 后端列表在排序和 limit 之前排除无用户消息、无附件、无已保存需求的空白会话；归档与删除记录不进入历史。
- 标题单行、尾部省略。长按菜单复用既有侧栏，232 dp 宽、五项图标列表、删除浅红底；无取消按钮及关闭按钮，点击弹窗外空白处收起。
- 置顶/取消置顶、重命名、归档、删除通过版本化、账号隔离、事务接口写回后端。PROCESSING 与旧版本拒绝更改。
- 添加到计划复用原会话的 promote → CreationDraft → PLAN 模式；不复制聊天，不直接创建第二套 Plan。Plan/PlanVersion 仍由确认流程创建。
- 删除采用软删除，已创建的 Plan/PlanVersion/运行记录不删除；未确认草案设为 DISCARDED。已删除会话不允许恢复、消息或一次性操作；其会话消息不继续投影为可操作事项。
- 专项 API 集成测试覆盖空白过滤、已保存需求、置顶排序、重命名、版本冲突、账号隔离、归档、同会话转草案、删除后 Plan 保留与草案不可恢复。3 项通过；相关 Consumer/Native 集成 3 文件 25 项通过。
- 真机证据：`artifacts/android/v8-productization/v81-history-compact-menu-final-20261005.*`、`v81-history-dismiss-outside-20261005.*`、`v81-history-pinned-20261005.*`。最终安装再次核对：`v81-history-compact-menu-installed-final-20261005.*`、`v81-history-dismiss-installed-final-20261005.*`，五项菜单与外部空白关闭通过。后端实际 pinned_at 已核对。

## V8.1 验收状态

| 顺序 | 项目 | 状态与证据边界 |
|---|---|---|
| 1 | 非空 Android Calendar | 用户真实事项“提醒我起床”读取得到 VERIFIED_PRESENT / 1 项，签名请求、授权与 Truth Audit 已核对，后端和真机日程只显示一次。全天标记已补齐，最终真机重读 VERIFIED_PRESENT / 1 项，日程显示“全天”且仅一项。修复手机比服务端快 373 ms 导致新健康证据被拒绝的问题，统一为签名接收接口已有的 1 秒容差，超过容差或过期仍拒绝。完整 Plan Golden Flow 仍等待确认/激活并绑定该真实日历来源的 Plan。 |
| 2 | 新 Share Receipt | PHONE_SHARE_EVIDENCE_PENDING。文件既有证据不替代 Share；未伪造 ACTION_SEND。外部浏览器启动被自动审批拒绝，仅返回 blocked by policy。已请求用户从实际 App 分享并保存。 |
| 3 | VoiceInputProvider | 用户确认实际说话内容“帮我整理一下今天的安排”，与可编辑输入框截图一致。Provider/Controller/Composer 没有自动发送依赖，已有测试通过。当前相关会话存在此前发送的消息，缺少隔离真机前后对照，无法仅凭这些记录断言发送按钮是否被用户点击；真机不自动发送的完整证据仍 Pending。 |
| 4 | Source Selection 最终 PlanVersion | 已复核 confirmPlan 同事务冻结来源与 PlanCreationContract/PlanVersion；恢复、运行评估、实际执行重验冻结来源。Native/自动唤醒相关集成测试通过。手机上的真实 Calendar Plan 绑定验收仍 Pending，不把隔离测试当成手机证据。 |
| 5 | Automatic Wakeup → Assessment → NextBestAction → WorkItem/Schedule | 已有代码与隔离回归证据保留。当前账号只有待处理的账单 Plan，无已确认激活的 Calendar Plan，不为验收偷偷激活。完整真机链 PHONE_AUTOMATIC_CHAIN_EVIDENCE_PENDING。 |
| 6 | Shipment / Bill / Consumable | REAL_EVIDENCE_PENDING，未生成假外部对象。 |
| 7 | Work Email | REAL_CREDENTIAL_PENDING，未配置假 Credential。 |
| 8 | 回归 / 最终 APK | Mobile 50 文件 / 292 项、Schema 31 文件 / 163 项通过；工作区 8 个类型检查通过，全天修改后 Mobile/API 类型检查通过。独立 API 全量 135 文件 / 944 项通过、61 跳过，另有迁移命名 guard 因未设置 TEST_DATABASE_NAME 失败；设置后迁移及最终增量 6 文件 / 36 项通过。时钟修复后 Native API 11 项、Schema 日历与时间边界 6 项通过。最终 APK 构建与安装 hash 见 Build 证据。 |

## 证据与环境

- 全天最终 Calendar：`artifacts/v81-calendar-allday-phone-evidence-20261005.json` 与 `artifacts/android/v8-productization/v81-calendar-allday-final-20261005.*`。
- Calendar：`artifacts/v81-calendar-nonempty-phone-evidence-20261005.json` 与 `artifacts/android/v8-productization/v81-calendar-single-real-item-final-20261005.*`。
- Voice：`artifacts/v81-voice-phone-evidence-20261005.json` 与 `artifacts/android/v8-productization/v81-voice-user-transcript-20261005.*`。
- Build：`artifacts/v81-history-build-evidence-20261005.json`。
- 保留之前服务请求与文件导入的真实证据：见 `docs/v81-closure-progress-2026-10-04.md`。
- 原共享测试环境全量首次为 929 passed / 7 failed / 69 skipped；修正旧导航/Adapter 数量/已 reviewed 场景/来源 observation freshness 等测试假设。共享 Redis 的实际 Worker 干扰队列存在断言；独立 Redis 下 P0 执行引擎 32 项通过，独立数据库/Redis 环境的真实 Worker 启动与消费测试已通过。这些多次结果不合并冒充一次零失败的全量运行。
- 独立回归环境使用新建的 MySQL 8.0.45（3311）与 Redis（6391），不修改业务数据库或实际对象。MySQL 8.4 镜像拉取受 Docker 已配置代理 127.0.0.1:7897 不可用阻止；8.4 RC Gate 不能宣称通过。

本台账不是整个 V8.1 已全通过的声明；真实 Pending 不阻塞已授权开发。

最终 APK 已重新安装，设备 APK 与本地 SHA-256 相同，打包 bundle 与最终源 bundle SHA-256 相同。本轮专用 MySQL/Redis 容器已停止，保留数据；业务容器未停止。


V8.2资源整改及JD PASTE/独立系统SHARE真实证据、kind/domain整改和最新APK跟踪：见 [V8.2 Resource Evidence Ledger](v82-resource-capability-progress-2026-10-05.md)。当前回归容器已重新启动用于V8.2，以上停止状态仅描述V8.1结束时。

V8.2本轮最终稳定API全量959通过/53跳过、Mobile300、Schema172通过，最新开发APK已安装并核对APK/bundle哈希；JD PASTE与独立系统SHARE、kind/domain真机结果见上述V8.2台账。既有V8.1日历、语音与历史结果保留，其余真实验收Pending不变。

## ServiceOffering 发布/编辑精细化
五种服务方式、四种价格模式、13领域独立筛选及旧数据迁移已完成；新版APK已安装，真机动态字段显隐通过。API相关23、Mobile303、Schema189测试通过。详见 docs/service-offering-fulfillment-progress-2026-10-05.md。未用伪造公开服务补真机发布证据。
