# 五大页面升级实施记录

本记录描述当前代码实现与证据，不代表总方案已全部验收。

## 已实现

- 设置保留消息获取、消息通知、后台服务、设备四项，新增 AI 服务第五项。
- AI 服务支持 DeepSeek Flash / V4 Pro、智能 / 快速 / 深度、保存、测试连接、删除。客户端只在输入期间将 Key 保存在组件内存，不写入本地持久存储。
- 每用户 AI 配置关联现有 CredentialProvider 加密凭据。读取 API 仅返回掩码，上传 Key 强制 HTTPS；支持可信反向代理或 API_TLS_KEY_PATH / API_TLS_CERT_PATH 原生 TLS。
- 现有 AgentModelAdapter 增加用户及工作上下文，生产使用 DeepSeek，测试环境保留现有 fixture。结构化输出经现有 Planner 校验；不向模型暴露可执行工具。
- 会话、消息持久化，版本冲突保护，重复请求复用结果。历史消息和模板作为独立上下文数据，不并入当前用户指令。临时会话转计划保留同一会话及历史。
- 计划页固定模板 / 我的计划，旧创建入口转会话·计划。确认计划读取服务端保存的合规草案，调用现有 PlansService 创建 draft，不直接激活或执行。
- 日程接入计划运行、服务请求、已确认日历事实、待处理记录、周期提醒。执行结果复用 projectConsumerOutcome，结果待确认不能呈现成功。
- 资源页固定本机 / 云端 / 其它设备 / 接口；本机读取原生设置证据，云端及设备读取服务端连接和心跳。
- 外部服务由服务端 ExternalServiceReference 持有，移除整个 App 推荐入口。原生文本分享具体链接进入人工确认页，保存后成为服务引用。
- 内部服务可预约、取消；提供方可确认预约、开始服务、确认完成。状态变化经身份及版本校验，记录事件，投影回日程。
- 0058 / 0059 迁移已应用开发库和隔离测试库，迁移安全检查通过。

## 已验证

- API 构建、API / mobile TypeScript 检查通过（每次后续更改仍须更新构建）。
- 49 项测试通过（其中 13 项为既有运行引擎闭环回归）：上下文与 Planner 门禁、加密凭据、DeepSeek 输出合同、日程时区边界、账号隔离、会话转计划、HTTP 密钥拦截、外部引用归属。
- Android APK 构建成功；已包含原生分享入口；仍需真机验收。
- 本地 API /api/health 返回 200。

## 未完成与外部依赖

- 用户已确认暂不提供 HTTPS 地址，保留密钥提交禁用；当前手机连接的开发 API 为 HTTP，不能提交 DeepSeek Key。需可信 HTTPS 地址与证书，或配置受信任 TLS 代理；不得关闭证书验证或放开 HTTP 上传。
- 未提供真实 DeepSeek 凭据，因此未进行真实模型连接与内容生成验收。
- 真机 2c696fe 已连接，已覆盖安装升级 APK（保留数据）。已核对日程、计划模板、资源、AI 服务页及设置返回；其余真机验收仍继续。
- 外部分享目前支持 text/plain 中的链接与标题确认；尚未实现网页元数据解析、图片 / 文件分享解析。已补外部服务详情及系统内嵌浏览器打开原服务。
- 接口页已支持公开 HTTPS JSON 数据源自助添加、连接探测、明确读取授权、读取预览和撤销；复用 Connection / Credential / Permission。需要密钥的 HTTP 接口和 MCP 自助接入尚未完成，不能把 fixture MCP 当作用户真实接口。
- 会话已支持 UTF-8 TXT / Markdown / CSV / JSON 文本附件（每份 48 KB，每条消息 3 份，每会话 20 份）；独立 Attachment 引用、SHA-256、归属校验、最近上下文恢复，每份最多读取前 16000 字符并标注截断。附件属于未验证数据，不作为指令。PDF / Word / 图片识别尚未完成。
- 已补自助发布内部服务：用户明确确认后复用 ServiceOffering 与 ServiceProviderProfile；新提供方不自动认证，评分为空，完成请求才增加使用计数。0060 迁移已应用开发及隔离测试库。已增加手机静态 JPEG / PNG / WebP 图片上传（最大 8 MB / 5000 万像素），服务端压缩至 1024 尺寸并移除 EXIF；发布前不可公开读取，发布必须引用本账号图片。
- 临时会话分析需求与结果已复用 Message authority 投影到日程，ANSWER 仅表示已生成答复；模型不可用、缺信息和待确认草案仍未完成。转为计划后保留原临时记录。一次性真实操作的完整 Execution 生命周期尚未接入，也未为会话草案统一绑定所有 CreationDraft 场景。
- 总方案要求的真实模型、真实设备、真实 Provider 的七条验收链路尚未全部完成。已有 fixture / 测试账户验证不能替代真实验收。

## 安全配置

通过环境变量向 API 提供 API_TLS_KEY_PATH 和 API_TLS_CERT_PATH，可直接启用 TLS。手机使用证书匹配的 HTTPS 主机名。若代理终止 TLS，必须精确配置 TRUSTED_PROXY_CIDRS；禁止信任所有转发来源。

CREDENTIAL_MASTER_KEY 与现有凭据存储配置沿用既有 Credential Service，不提交到代码库，不在审计或日志中输出 API Key。

## 真机连接恢复后续进展

- 最新包含自助服务发布表单的 Android APK 已重新构建成功（Gradle assembleDebug）；最新 API 已重启。此次覆盖安装与启动组合命令被自动审批拒绝（blocked by policy），未完成本次真机更新，不能将上次安装视作最新发布功能已验收。

- 设置页返回已在真机点击验证，能回到日程。
- 外部服务详情接口验证归属，提供原服务打开动作，不将引用表示成已购买/已预约。
- 会话修改计划生成同一 Plan 的新版本，并绑定生成时版本；并发修改使旧草案失效，不直接启用。
- 日程增加已有 Plan authority 的下次预计运行投影。
- 开发 / 生产环境禁止装入 MCP fixture；测试环境保留，3 项隔离测试通过。
- 本轮消费者接口 6 项集成测试通过，覆盖发布、预约、角色权限、完成回到日程、幂等和版本冲突。服务履约仍需真实用户与提供方验收。
- 自动审批拒绝模拟 Android ACTION_SEND 测试命令（仅返回 blocked by policy）。已验证链接进入添加确认页，但原生分享分发仍待真实 App 操作验证；测试链接未保存到用户账号。

## 后续开发补齐（2026-10-03）

- 修复资源投影与旧资源目录 `/resources` 路由冲突，五页资源投影改为 `/consumer/resources`；旧目录 authority 保留。
- 0061 文本附件与 0062 服务媒体迁移通过安全检查，已应用开发和隔离测试库。
- 公开 JSON 读取固定 GET、不跟随跳转、校验并固定公有 DNS 地址、保留 TLS 验证、限制 128 KB 与网络期限；拒绝私有地址、密钥参数和任意端口。接口原始响应不等于已验证 Truth。
- 模型会话请求放宽至 65 秒，连接探测至 15 秒，服务图片上传至 20 秒，普通读取保留 3 秒。
- 历史草案卡片不能确认当前另一份草案；上传后的会话缓存按实际 conversationId 刷新。
- 本轮覆盖新增附件、图片、接口授权、撤销、临时分析日程和资源路由测试；集成数据仅在隔离测试账号创建。
- 尚未完成最新版覆盖安装和真机验收；此前安装命令被自动审批拒绝，不能将构建或模拟测试视为真机通过。

- 服务进入会话改为 ServiceOffering / ExternalServiceReference ID 引用：后端校验归属及发布状态，每次生成重新读取；服务说明属于不可信上下文，不拼入用户指令。0063 迁移已应用。引用失效呈现“需要更新上下文”，不会伪装为模型故障或执行成功。
- 资源可用能力必须同时具有有效健康证据与用户授权；接口探测成功不自动授予读取权限。
- API 集成与网络边界 / 投影测试 21 项通过；既有 R7 Planner 单元 20 项通过；手机 API 环境与超时 10 项通过。API 构建、手机 TypeScript 检查通过。

- 本轮最终 API / mobile 构建检查通过，Android assembleDebug 成功；API 已重启且 health=ok。设备 2c696fe 仍已连接，但本轮没有完成覆盖安装，APK 构建与真机验收分开记录。

## 当前优先开发批次：一次性运行与 CreationDraft（2026-10-03）

- 新增 ConversationOnceRequest，仅保存请求身份、输入摘要和既有 Plan/Version/Execution 引用。运行已启用计划一次复用 ExecutionDispatchService、既有 worker、审批、Reconciliation 与后端 outcome 投影；重放不创建第二个 Execution，输入变化拒绝。日程中的 TEMPORARY_TASK 必须对应真实一次性请求。
- 隔离数据库实测 in-app 通知持久化、always 审批暂停、非本人审批拒绝、本人审批恢复、同一 Execution 重放与结果投影一致。此项覆盖已有计划的一次性运行；AI 临时需求直接生成新一次性动作、手动输入表单尚未完成。
- CreationDraft 在既有 Authority 中增加 conversation scope，0065 保留旧草案并补会话/提案外键。计划会话、模板、场景向导重定向、服务上下文、临时会话转计划绑定同一草案。未解析场景保留 __pending__，不宣称能力就绪。
- 增加独立保存需求接口，无 DeepSeek 配置也可保存；同场景不同会话不覆盖，恢复已绑定草案返回原会话。确认真实提案与既有 Plan 写入同一事务完成草案。过期/丢弃草案不能通过需求保存重新激活。手机保存与恢复期间锁定会话切换、附件、发送等竞争操作。
- 新增 MCP 安全阻断：删除旧适配器通过 MCP_SIDE_EFFECT_APPROVED audit row 直接执行以及将 schema 合规当 READ_BACK 成功的路径。旧接口永久返回未验证、不可执行。**这只是关闭旁路，不表示 MCP 已接入完整 Capability/Risk/Approval/Outbox/Verification**；正式连接器和真实供应商读回仍待开发。
- 本批真实隔离 DB 集成与 MCP 阻断回归：5 文件 / 28 测试通过（含 R7 enabled 集成），非真机 E2E。此前 API 构建、手机 typecheck 通过；本批最终重建另行核对。
- 通用文档 Artifact/Extractor、全部场景合同衔接、AI 新一次性动作和完整 MCP 接入仍未完成。HTTP DeepSeek 密钥提交保持禁用。
- adb 实查 2c696fe 在线。此前覆盖安装命令被自动审批拒绝（blocked by policy，仅此理由），本批不绕过拒绝；最新 APK 构建不能视为已安装或真机已验收。
- 本批最终 API build、mobile typecheck 和 git diff --check 通过；Android assembleDebug 成功，APK 更新时间 2026-10-03 18:28。后端已用最新 dist 重启，/api/health 返回 status=ok，mysql/redis/bullmq ready。APK 尚未覆盖安装，不代表真机 E2E 通过。

## 新 ActionProposal、统一文档与真机验收（2026-10-03 21:35）

本节为最新状态，更新以上“待开发 / 未安装”的历史记录；不将集成测试与真实供应商验收混为一谈。

- 临时会话新增 ActionProposal 合同。服务端编译为不可启用、不可修改的 ONCE PlanVersion，复用既有 Resolver、Risk、always Approval、Execution Worker、Verification、Result 和 Audit。AI 不执行动作。当前支持真实站内通知；其他动作必须存在真实连接及能力合同，不能把任意本地动作标为可执行。
- 站内通知能力由 Resolver 绑定冻结动作，不使用虚构连接；模型不得自造 requiredCapability。实际通知持久化后按 Execution / 幂等身份读回，校验标题、正文，保存 LOCAL_READ_BACK 和 LOCAL_EFFECT_VERIFIED。请求及并发重放复用原 Execution，不出现在“我的计划”，也不能通过常规激活/手动执行旁路运行。
- 模板 +、计划 +、会话·计划和临时转计划统一绑定 CreationDraft；恢复返回原会话。转计划保留最近的真实用户需求，不能把 ActionProposal 自动变成已确认长期计划。新入口清理旧输入，按账号隔离恢复。确认过的一次性提案在日程由实际 Execution 代替，不重复保留未完成会话项。
- Draft gaps 是只读后端投影：场景、缺失事实、资源/能力候选及原因、主体缺口、场景版本变化、相关内部服务及已引用外部服务。全部已登记场景的查询经过隔离 DB 回归。发布服务或外部引用不等于已补足能力；旧场景的结构化 V2 source-choice 合同仍按现有规则要求重新确认，没有虚构全场景资源就绪。
- 新统一 Artifact 保存原件哈希、原件、提取器版本、提取文本哈希及归属。Text / PDF / DOCX 使用同一入口；PDF / DOCX 在限时、限内存子进程提取，附件只引用 Artifact。账单及交易导入复用 Artifact，业务解析沿用现有 Authority。文档文字属于未验证用户资料，不自动升级 Truth；不含 OCR。旧文本附件仍兼容，未做无必要的批量回填。
- MCP 新增运营方固定 schema / 写工具 / 独立读回工具 / 内容比较合同的连接器，登记到现有 Capability Registry、Resolver 和 VerificationPolicy。只有真实已审批且 executing 的 canonical outbox operation 可写入；风险下限 R3。schema 变化或撤销权限拒绝调用；读回不匹配是 OUTCOME_UNKNOWN，通过既有 Reconciliation 查询恢复，禁止盲目重写。旧旁路仍关闭。HTTP transport 增加标准 initialize / session / structuredContent、身份核对、期限与流式响应体上限，禁止重定向，缺少只读标记默认按副作用处理。
- MCP 主链用显式隔离测试服务器验证：审批后一次写入和独立读回、读回不一致后仅查询恢复、审批后撤销权限不写入。**尚无真实外部 MCP endpoint / 凭据 / 运营方 binding，不能宣称真实 MCP 服务或生产部署已验收。** 需要公开可发现的工具目录；只允许带凭据的工具目录发现仍需补充配置机制。
- 服务器私有 .env 开发 Key 仅在 NODE_ENV=development + 显式启用 + 官方 HTTPS 下可用；恢复了启动配置校验丢弃新增变量的问题。用户个人配置被撤销或禁用时，不静默改用开发 Key。手机只拿到配置来源和状态，不拿开发 Key；用户 Key 的 HTTP 提交仍禁用。首次真实调用返回官方 402，未回退 Fixture；用户充值后真实 DeepSeek Flash 调用通过。
- 后端真实 E2E：`artifacts/real-action-e2e-result.json`。真实 DeepSeek 生成通知 ActionProposal → 请求确认 → 独立审批 → worker 执行 → 通知读回 SUCCEEDED → 日程 COMPLETED；重复确认返回同一 Execution。
- 真机 2c696fe 实際点击 E2E：AI 提案、确认操作、审批详情、确认弹窗、执行完成与日程完成项。真实 Execution 为 `01a101e4-44ff-732a-ba00-15ea315d3ae2`；已查询实际审批、通知记录、LOCAL_READ_BACK=SUCCEEDED、APPROVAL_REQUESTED / APPROVAL_APPROVED / LOCAL_EFFECT_VERIFIED / EXECUTION_TERMINAL Audit。证据：`artifacts/android/upgrade-20261003/phone-action-truth.json`、`final-execution-real-phone.xml/png`、`final-timeline-real-phone.xml/png`。
- 真机额外验证：计划需求保存及恢复有对应数据库版本；模板 + 保留 monthly-bill-summary 与 Draft；手机 PDF 选择、上传、提取和会话 Artifact 引用成功。证据：`phone-draft-truth.json`、`phone-template-truth.json`、`phone-artifact-truth.json`。HTTP Key 输入禁用有页面 XML 记录。
- 真机暴露并已修复：执行页将审批原因/通知正文误送错误翻译造成假的失败提示；日程长标题被同行状态标签挤窄。手机显示仍读取后端状态，不自行推断成功。
- 最终 API 回归 7 文件 / 29 项；文件导入回归 9 项；MCP SDK 协议边界 9 项；配置 63 项；手机 API 10 项通过。API build、mobile typecheck、plan-schema typecheck、0066–0068 迁移安全与 segmentation 检查通过。真机验收与这些隔离测试分别记载。
- 最终 APK assembleDebug 成功，2026-10-03 21:31 构建，已覆盖安装（adb install -r 返回 Success）。SHA256：`71AA13E7052A214D4748A92556C15351BF30BAA0572D36B19651A8C791DC836E`。API / Execution Worker / Outbox Worker 正在运行，health=ok；最后真机停在日程的已完成页，展示实际通知结果。
