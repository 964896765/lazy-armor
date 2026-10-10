# V88-REPORT-02 公开资料检索与报告更新

目标：让 App 自主提出检索词、从已授权网站范围取得原文，并据此更新报告。V88-REPORT-01 的假设稿保留；开发助手抓取资料或直接撰写正文不能替代真机全链验收。

Backend：新增只读 `public_web_research` 资源与 `READ_PUBLIC_WEB_RESEARCH` 能力，接入原 ConnectorRegistry、Manifest、Connection、逐项 Permission、健康检查、限流、用量和 ConsumerReadSource fencing。Connection 创建不会自动授予权限。用户保存一至三个 HTTPS 入口，读取范围严格为入口的 exact origin，不自动扩大到子域名；配置保存到原 credentials authority，不新增表或迁移。来源模式 PUBLIC_WEB 只表示公开网页，不伪装官方 API 或 Reality Truth。

检索：App 模型根据目标自动提出最多两条搜索词，尝试必应公开搜索并过滤范围外链接；不跟随跟踪跳转，而是解码目标后核对范围。搜索失败或无范围内结果时，从实际读取的网站入口发现链接，明确标为 AUTHORIZED_SITE_DISCOVERY，与 SEARCH_RESULT 区分。模型只能从实际候选逐字选择最多三条 URL；服务器拒绝自造 URL。读取后才进入报告 sources，候选标题和摘要不是原文证据。最多六项 S 来源并保留一个 M1 财务计算来源。

读取：仅 GET 公开 HTML/XHTML，无 Cookie、账号登录、表单、JS 执行或 PDF 解读。DNS 全部结果须为公共地址，并将已检查的地址固定到 TLS 请求；优先 IPv4，以解决本机 IPv6 解析成功但不可路由的问题。TLS 校验不关闭，重定向不自动跟随，1 MB 响应上限及解析/读取 deadline 有界。提取实际正文（最多一万字符）、标题、原文 URL、网页声明的发布时间、读取时间和正文 SHA256。缺少发布时间保留 null，不能把读取时间当作发布日期；截断与不能读取的网页明确记录。

Runtime：沿原报告 execution-worker 队列运行；自动提示词 → 检索词 → 候选选择 → 原文 → 报告 → 检查/一次修订 → 同一会话。每次读取沿原 invokeConsumerRead 校验；来源 authority hash 持久保存，在写作前和发布前再校验。撤销权限、撤销后重授、连接配置/健康证据变更都会阻断旧任务发布。事实仍是 SOURCE_RESPONSE_ONLY，财务参数仍是模型假设，不生成 Truth 或外部 Execution，也不替代 V87 Act/read-back。

Frontend：资源/接口增加公开网页检索入口，范围页明确展示网站、搜索词发送到必应以及读取范围；本人开启/关闭权限沿原 Permission endpoint。报告来源卡展示原文地址、发布日期（缺失则标未取得）、读取时间、检索词与获取方式，可本人打开原文。旧报告与失败记录保留。

Test：网页与模型边界单元 16/16；报告集成 6/6、公开网页报告授权集成 5/5、原 Consumer 页面回归 14/14（隔离 MySQL、独立 Redis prefix）；SDK 59/59、共享合同 259/259、Mobile 416/416、八包 typecheck、API 构建、Android embed/Hermes/debug APK 通过。新增验证覆盖范围外/子域名/伪装域名拒绝、混合私有 DNS、地址固定、IPv4 优先、跟踪目标解码、无搜索结果的获取方式、发布日期缺失、实际原文链接合同、权限撤销及撤销后重授阻断发布、本人之外读取范围配置 404、零 Truth。两轮集成初始化在并行构建负载下触发 30 秒 hook deadline，失败日志保留；Consumer 单独复跑通过，新增网页集成单独以 90 秒初始化 deadline 复跑 5/5，断言未改变。SDK PUBLIC_WEB 未添加到 Truth/Reality 的来源适配器。

Runtime 实证：IPv6 首轮适配器读取失败保留。修复后实际读取荆门官网并发现 40 条候选，实际读取政府公报页面，标题、URL、页面发布时间和 532 字符正文均来自 HTTP 响应；这是适配器网络探针，不替代本人授权或 App 报告证据。必应及一条入口探针未成功，未将失败或范围外结果伪装为搜索命中；另一个官方子域 HTTPS 证书不匹配的探针被拒绝，未关闭 TLS 校验。

手机安装：APK `artifacts/android/v88-report-web-r2.apk`，SHA256 `742be23cd93162ca3a63b671ac170201fa650f620b596e55d8f93fbdf0ea8c68`；手机安装包与构建包一致，内嵌 HBC 与构建输出一致，保留数据安装。原十二个登录/Runner 文件哈希不变，tracked generated bundle 原字节恢复。初版打包被 Windows PowerShell 对原生 stderr 的处理打断，日志保留；使用 pwsh、明确 NODE_ENV 重新构建通过。三角色本地 ready；替换前真实 execution/outbox lease 均为零。

依赖：仅新增公开 HTML 解析依赖 cheerio，未使用的 XML 依赖已移除。全仓依赖审计报告原有 8 项问题（含 5 high / 2 critical），未宣称依赖审计通过；记录 `artifacts/v88-report-web-dependency-audit-r1.log`，发布门继续保留，未做生产发布。

本人授权：正常已登录手机 UI 新增官网资源 `01a12644-d43e-75ca-a19c-c1db6feaf929`，范围仅 `https://www.jingmen.gov.cn/`。初始实际页面显示读取权限未开启；本人随后在 App 开启并确认，页面和只读 metadata 均显示 GRANTED / granted=1。未提取 token、未直接改 DB grants。原“检查连接”按钮刷新健康后，正常原会话提交新需求，新增报告 message `01a1264b-b132-73d6-9b32-25d379bdbd74`，实际进入 PLANNING；本人批准的是公开官网读取，未扩大到其它网站或子域名。

真实任务修复：首个资料更新 message `01a1264b-b132-73d6-9b32-25d379bdbd74` 虽为 COMPLETED，但 plan.connectionIds 为空，只有 M1，没有网页原文，不能当作检索验收通过。新增提纲合同要求：存在相关网页资源且生成搜索词时必须选相应资源 ID，第一次不符合会携带具体合同纠正重新规划一次；仍不符合则失败。明确网页资料任务没有实际网页来源时为 FAILED / REPORT_WEB_SOURCE_REQUIRED，不发布假设稿冒充检索完成。历史报告不复活或改写。

后续新任务 `01a12656-1486-70f2-b401-84ed473d24cc` 已选资源和实际检索，但未选相关正文，保留 FAILED；`01a1265c-a48f-77b7-a442-d06c06861f19` 选定网页正文不足，保留 FAILED。模型选源进一步要求选择文章正文，有限营商环境/城管背景不能证明洗车车量、租金、排水许可或盈利。有效 HTML 但正文不足改为 WEB_TEXT_INSUFFICIENT / INVALID_REQUEST，拒绝该资料但不误判整站故障；真实验证/挑战页面继续拒绝。隔离集成证明不足资料后仍可按同一授权读取下一篇有效正文，撤销和撤销后重授仍阻断发布。模型合同错误不再被吞掉为普通网络缺口；安全诊断不记录凭据。

最终真机报告：message `01a12664-a089-764a-bbc7-d24cc10c000e` 于 2026-10-10 23:19（上海）COMPLETED / revision 6。正常已登录手机会话提交新目标，实际 DeepSeek 自动形成 2211 字符提示词、两条搜索词、六章节提纲，实际读取三篇授权官网原文，生成并自动修订 7783 字符正文及程序财务附录，最终 review issues=[]，六项建议保留。共五条原 usage_events：两次 search、三次 page，均为该任务原 ConsumerReadSource 调用。未提取 token、直接写个人任务/权限/Truth 或使用 fixture 替代真机。

| 来源 | 实际原文 | 页面发布时间 | 本次正文字符 | 采用范围 |
| --- | --- | --- | ---: | --- |
| S1 | https://www.jingmen.gov.cn/art/2026/10/9/art_440_1241233.html | 2026-10-09 08:43 | 1085 | 城管市容、占道和进城车辆冲洗实践；正文引用 |
| S2 | https://www.jingmen.gov.cn/art/2026/9/23/art_1074_1240195.html | 2026-09-23 10:00 | 10000 | 法治营商环境有限背景；正文引用，已披露截断 |
| S3 | https://www.jingmen.gov.cn/art/2026/6/12/art_18718_1222878.html | 2026-06-12 09:13 | 1217 | 大学毕业生住房政策；读取保留但正文未采用 |

三篇都明确标为 AUTHORIZED_SITE_DISCOVERY：本机必应未返回可用范围内结果，实际从授权入口发现并读取，不能宣称必应命中。报告明确未取得荆门机动车保有量、竞品价格与台次、具体铺位租金、行业排水许可原文；财务参数仍为假设，产能未通过实测，不提供实际盈利或回本承诺。S3 未引用的排除说明作为检查建议保留，不能称三篇均被正文采用。

最终增量 Test：网页/模型/授权三文件 20/20，随后新增“正文不足后下一篇有效来源仍可读取”授权集成单独 7/7；原报告集成在本轮 18/18 联合专项中通过（包含重叠测试，不累计）。API typecheck、三次 API build、Mobile scope 恢复增量 typecheck、hygiene/truth/terminology/diff 通过。手机资源检查恢复后同时刷新 scope，读取授权状态失败不再显示“未开启”，避免网络失败误报本人权限。原权限和发布权威未放宽。

只读验收 14/14：完成状态、真实模型、自动提示词/搜索词、实际原文、exact origin/connection、每项正文 SHA256、原文日期/读取日期/检索词/获取方式/authority hash、M1计算、章节引用合同、无阻断检查、零新增 Truth、五条原读取用量、旧报告和两次失败完整保留均通过。证据 `artifacts/v88-report-web-phone-final-review-r10.json`、`v88-report-web-phone-audit-r2.json` 与实际报告页截图。首轮 audit 使用无连字符的物理 HEX messageId 查询有连字符的请求 ID，未命中用量；失败证据保留，修正只读审计脚本后五条原用量被准确匹配，没有补写数据。

最终手机安装与展示：scope 恢复增量打包 `artifacts/android/v88-report-web-r3.apk`，SHA256 `93794f713b607a50c0237fa6fd394d31b3ba80c3d85bd7993720e465fefe91e3`，HBC `31822478836b956ffaf887035e03796f2957ec618009de74f2b7ff9bf9aa9c87`。保留数据安装，安装包 hash 与构建一致，APK 内嵌 HBC 与构建一致；无重新登录或授予权限。手机实际报告页显示“报告已生成”，已展开模型提示词、查看正文中有限事实与假设边界、实际来源表与三项来源卡片，原文 URL、发布时间、读取时间、自动搜索词、入口发现方式、打开原文按钮和完整性检查均可见。证据 `v88-report-web-install-verification-r3.json`、`v88-report-web-phone-installed-report-header-r12.png`、`v88-report-web-phone-prompt-expanded-r12.png`、`v88-report-web-phone-source-cards-r12.png`。最终本地 API 34880、execution-worker 35564、outbox-worker 27004，实际 ready 均 200；三个替换检查点均为零 active report/execution/outbox lease，无历史任务重跑。

完成状态：V88-REPORT-02 IMPLEMENTED / AUTOMATION_VERIFIED / APK_INSTALLED / REAL_PHONE_SOURCE_REPORT_VERIFIED。App 自主提示词→查询→有限范围原文→报告→修订/检查→App 查看子闭环完成。V88 七天、V87 外部 Act/read-back、V89 实际第三方、V90 联合验收及 0083 migration release gate 仍待验；原依赖审计问题继续保留。无新 SQL 迁移、提交、推送或生产发布。
