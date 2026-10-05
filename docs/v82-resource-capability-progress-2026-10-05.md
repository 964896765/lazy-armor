# V8.1 / V8.2 Resource Capability Evidence Ledger — 2026-10-05

沿用现有 local_capability_states、device_app_connections、external_service_references、Artifact 与 Reality Pipeline，不建立第二套资源/Connector 系统。下面的 Pending 不等于 VERIFIED_EMPTY。


## 最新结果（本轮结束）

- Share/Paste统一链、ExternalReference kind/domain整改已构建并安装；真实JD前台复制粘贴保存PRODUCT+life，真实系统SHARE另有签名Acquisition。原文Evidence保留，引用候选仍PENDING，不代表价格、库存、交易或物流事实已确认。
- 服务页只列SERVICE并按domain筛选；统一“我的外部引用”按kind、domain独立筛选。外部服务+携带expectedKind=SERVICE，京东文案提示商品不会显示在服务页，可继续保存，无必选类型/领域步骤。
- 稳定最终API全量137文件通过/4文件跳过，959项通过/53项跳过、零失败；Mobile51文件/300项、Schema33文件/172项、Shared2文件/7项通过。API日志 artifacts/v82-api-stable-full-regression-20261005.log，历史失败及修复保留在后文，未合并多次结果。
- 最终APK与手机安装APK SHA256均为d273794bdbeb97f0638b44e473f92cf529bcf0077c9d957471ecd97766c32b6c；bundle与安装APK内bundle均为8cd63675cf0ff0c6e78d150f20348814ec33f5e85dc68e781abf03131dd49e5f。开发环境APK，API localhost3001通过adb reverse；构建证据 artifacts/v82-resource-build-evidence-20261005.json。
- 其余未实现的本机执行/媒体适配、受控AppReadSession/StructuredRead与App专用Profiles保持NOT_IMPLEMENTED/Pending；HTML/image/PDF/multiple真实Share证据、Voice独立no-auto-send对照、完整Plan自动唤醒链、真实Shipment/Bill/Consumable与Work Email凭据仍依原台账Pending。这不是V8.1/V8.2所有能力已完成的声明。

## Share/Paste 与 ExternalReference

- 共享 ShareTextParser 位于 packages/plan-schema/src/share-text-parser.ts。Android 只收原始 bytes/text；手机和后端均使用同一函数。移动端使用不包含 Node crypto 的 share 子入口。
- 输出 sourceUrl、urls、sourcePlatform、titleCandidate、shareCode、kindCandidate、rawText、parserVersion、ruleId。两份京东文案均通过合同：ZH9112 / -35RF2ah 与用户新提供的 CA1565 / 35RO-7uG；标题均为“100双中筒袜”，3.cn 为 JD，PRODUCT。原文包含的“京东物流”只是标记，未被当成物流对象。
- 多 URL 保持 AMBIGUOUS，UI 必须明确选择包含在原文中的链接；后端拒绝原文之外的 URL。无 URL 只保存 Artifact，不伪造链接或 ExternalReference。
- ACTION_SEND / SEND_MULTIPLE 接收 text/plain、text/html、image/*、PDF。文本/HTML走同一 Parser；文件经内容摘要匹配与 signed per-operation acquisition 进入现有 Artifact。每次最多 5 文件，每份 2 MB，任一读取失败不保存部分引用。PNG/JPEG/WebP做实际图片元数据验证，OCR/Vision未部署时保留 PENDING；文本 PDF走既有离线提取器。GIF等暂未被后端Extractor支持的格式不可声称通过。
- 原有 external_service_references 表增加 kind/raw_text/parser_version/rule_id/share_code/evidence_artifact_id，0073迁移已应用业务与隔离测试库；externalReferences为同表兼容别名。新增 external-references 路由，原服务列表仅返回 SERVICE。
- 商品作为 SERVICE 拒绝；sourcePlatform由共享解析器确定，忽略客户端伪称。原文保留为 Artifact；SHA-256与原文不一致、跨账号引用Evidence拒绝。SHARE导入必须对应实际已验证 signed acquisition，不能仅凭客户端 importMethod 伪造。
- Artifact和ExternalReference进入现有 Observation → Candidate；候选PENDING，未自动确认为销售、库存、支付或物流Truth。会话支持 ExternalReference 上下文，计划仍走 CreationDraft确认主链。
- 重试同一Artifact/URL在事务锁下返回已保存的引用；来源时间沿用原Artifact/Acquisition时间，不用保存时间伪造Freshness。

## 本机能力与 App 通用层

- 扩展同一Local Capability目录；旧files.read/location.read/appusage.read/share.read/voice.input等ID和授权通过canonicalKey兼容，不另建重复授权库。旧photos.read只作为兼容项，不在新资源列表重复展示媒体能力。
- 目录覆盖用户列出的能力。calendar.create、media.pick、camera.capture、app.launch、deep_link.open、background.device_task等尚未完成实际端到端能力保持NOT_IMPLEMENTED/Pending；不能因有Android API就显示AVAILABLE。已实现剪贴板仅前台主动读取，没有监听器；network.status/battery.status通过实际OS读取与signed acquisition，无结果/错误不能报告EMPTY。
- SMS/CallLog=PLATFORM_RESTRICTED，后台位置/Accessibility=SPECIAL_PERMISSION，notification.send当前=UNSUPPORTED。系统权限与Lazy Armor userGrant独立管理。
- 本机页按信息获取/设备执行/高级能力分组，展开显示OS权限、用户授权、健康、检查时间、签名证据与当前PlanVersion绑定的关联计划。
- Generic DeviceApp为所有真实discovery的launchable App提供基础层；receive_share通用运输链已经接入，逐项能力依赖当前native grant/health及安装证据，不能将它理解成STRUCTURED_READ或交易事实解析器。
- App能力逐项返回 open_app / notification_read / receive_share / deep_link / app_read_session / structured_read / vision / execute。AVAILABLE要求installed、permission、userGrant、adapter、health及fresh evidence；execute=UNSUPPORTED，无profile的增强能力UNAVAILABLE。移除“整个App available”布尔判断。新增signed discovery刷新接口，不隐式更改用户授权。
- OS真实launchable discovery记录：artifacts/v82-launchable-device-discovery-20261005.txt；确认包含京东、淘宝、微信、支付宝。未凭名字猜其它package；尚未建立带真实手机Evidence的专用Profile，全部增强仍Pending。
- FactDemand/SourceResolver沿用既有事实要求、SourceSelection与排名；native manifest v3兼容旧v2；SourceResolver不使用AI权威判断，未知reliability不赋乐观默认。来源运输可验证不等于业务事实已验证。

## 当前验证

- Schema最新全量33文件/172项通过。Mobile最新全量51文件/300项通过（包括kind/domain隔离与最近时间边界）。Shared2文件/7项通过。
- API最终专项6文件/30项通过；随后通用能力刷新/状态增量2文件/17项通过；最新Reference/Artifact/Native/App专项4文件/23项通过。与之前V8.1 API全量记录分开统计，不冒充新API全量。
- 已安装第一版V8.2 APK；最终细节修复后再更新hash与安装证据。
- 电池真实signed acquisition VERIFIED_PRESENT/1项，artifacts/android/v8-productization/v82-battery-read-20261005.*。
- 早期剪贴板实读为空，彼时不能算JD Paste验收；最终已用真实前台剪贴板保存成功，见最新结果。用户确认京东自定义分享面板未调用系统Sharesheet，JD=PASTE（COPY/PASTE）独立验收；不要求JD直接ACTION_SEND。另用真正调用系统Sharesheet的浏览器/应用验收SHARE。这两项早期Pending已由后文独立真实证据补齐。
- HTML/image/PDF/multiple Share端到端手机Evidence仍Pending；合同测试不是实际外部对象证据。
- V8.1日历全天、语音用户确认和历史整改证据保留；完整CalendarPlan/自动唤醒真机链、Shipment/Bill/Consumable真实对象与Work Email真实凭据继续依原台账Pending。

外部引用列表按kind分类，保存后主动刷新并进入统一列表；PRODUCT/PLACE/CONTENT/DOCUMENT/EVENT不会出现在服务列表。直接adb向京东打开真实短链被自动审批拒绝，仅返回blocked by policy；未绕过，不能将该尝试作为真实证据。


## 后续整改：kind / domain 与真实引用证据

- ExternalReference 使用独立 kind 与可空 domain；0074 迁移已应用业务与隔离测试库，旧 category 仅按明确领域词兼容迁移，不推断 kind。新接口不要求 category/domain；非法 domain 拒绝。服务页先严格 SERVICE，再按 domain 筛选；外部筛选为全部/最近（30天）/生活/家庭/出行/工作/更多，内部推荐 Domain 保留。
- 添加页显示解析类型（可修改），不默认铺开必选类型；可选领域仅凭原文关键词推荐，不明确或多领域留空，不成为来源事实。服务入口携带 expectedKind=SERVICE；识别其它kind时提示会保存到统一外部引用，不会出现在服务页。
- 真实手机后端记录：JD PRODUCT reference 01a109e6-41ec-72dd-9197-cab329984db8，URL为用户CA1565样本；原文Artifact 01a109e6-41d6-72ac-b07b-289fbfe51103，SHA256=287ec6ce49c43cea29d2711309589912091d2da905ce68339a7e5a73b03e8870。JD按PASTE工作流验收，后端来源标记MANUAL，无伪造签名剪贴板收据。
- 系统SHARE：真实闲鱼链接 https://p.goofish.com/p/5luebUTp，reference 01a109e7-6783-750b-aee6-059a9495d5b5，Artifact 01a109e7-66cf-757b-ba8d-74f013899f7e；signed acquisition 01a109e7-6746-73b6-90f5-96bd9a63ae10，VERIFIED_PRESENT/1。这里只证明实际分享运输与原文，不证明商品交易事实或特定来源App身份。
- 原文hash与Artifact核对一致，引用候选仍PENDING；核对脚本/数据在 artifacts/v82-phone-reference-check.cjs、v82-phone-reference-status.json。已有多次用户保存记录保留，未擅自删除。
- 新版真实OS网络、电池读取已取得VERIFIED_PRESENT/1及observedItems audit；手机截图 v82-network-read-final、v82-battery-read-final。文件/日历旧证据保留。
- kind/domain最新API专项3文件/18项通过。先前全量955通过/3失败；已修复Artifact额外候选测试、Offer生成与确认pin范围不一致、Worker固定3011端口误读业务健康。修复回归财务/引用等19项、Worker6项通过（2个故障注入CI跳过）。新一轮全量仍出现安全/多Worker失败，等待完整错误及定位，不宣称全量通过。
- 曾发现共享库dist未重建导致领域推荐运行时undefined；已重建plan-schema，重新打包安装与实机复验进行中。最终hash以 artifacts/v82-resource-build-evidence-20261005.json 更新后为准。


### 稳定构建与回归补记

- 第二次全量：134文件通过/3文件失败/4文件跳过，955项通过/4项失败/53项跳过，日志 artifacts/v82-api-full-final-regression-20261005.log。运行途中收到domain整改，API dist重建造成真实multi-worker启动时app.module缺失、运行中模块仍使用旧DTO造成domain400；该次不作为最终稳定快照全量结果。
- 安全测试失败的审批仅默认2秒有效，在本机编译负载下过期，首例断言未通过又使凭据恢复步骤未执行，导致后例级联失败。该suite设置测试审批TTL60秒，过期用例仍直接控制数据库时间，未改生产审批/权限安全机制。
- 全量结束、API构建稳定后的复验：安全/真实多Worker/ExternalReference共3文件12项全通过，artifacts/v82-stable-failure-regression.log。此结果单独列出，不合并声称一次全量零失败。
- 最终手机构建显式development + http://127.0.0.1:3001，adb reverse；共享schema/database产物先重建。Metro清缓存并导出资源到独立artifacts/v82-final-assets，50资源与Android已有资源逐份hash一致。APK构建成功、本地APK=安装APK、bundle=手机APK内assets/index.android.bundle。完整hash见 artifacts/v82-resource-build-evidence-20261005.json。
- 新手机启动恢复正常，实际日历事项保留。服务页已观察到新外部Domain tabs且商品/OTHER引用不显示；服务入口+的最终实机交互正在复核，未将旧TypeError截图作为通过证据。


### 最终 kind/domain 真机通过

- 用户确认未同时操作手机后，逐步点击外部服务+，进入统一Editor；真实前台剪贴板仍为京东CA1565文案。截图 artifacts/android/v8-productization/v82-final-external-plus-coordinated.*、v82-final-real-jd-paste-domain.*：PRODUCT、JD、CA1565、标题正确；自动建议领域life，显示商品不会出现在外部服务的说明，没有必选类型/领域步骤。
- 在该真实界面确认保存后返回并刷新“我的外部引用”；真实新reference 01a10a04-b0a5-72e1-860b-55343c225971，kind=PRODUCT、domain=life、来源MANUAL（PASTE工作流）、Artifact 01a10a04-b086-767e-b48f-af22d4f746ce，原文hash一致、候选PENDING。
- kind=商品 与 domain=生活 两项独立筛选实机通过：v82-final-kind-domain-independent-filter.*。服务页不展示这些PRODUCT/OTHER记录；内部Domain推荐保留，外部Domain tabs改名实机截图已留存。
- 资源能力其它Pending范围不变；当前重新启动稳定产物下的最终API全量（artifacts/v82-api-stable-full-regression-20261005.log），期间不修改源码或重建API dist。完成前不宣称零失败。


最终稳定全量已完成：API959通过/53跳过，无失败；本轮专用MySQL3311/Redis6391容器已停止、数据保留。业务API/数据库/Redis未停止，手机保持最终新版。全部未接入适配与缺失真实Evidence依上述最新结果保留Pending。
