# Auth V2 · M4-01 Web Passkey 与原账号会话

日期：2026-10-14。基线0057ee66，分支codex/v83-persistent-runtime。本批提供Web通行密钥注册、登录、多凭据列表和安全移除，登录页与账号安全中心同步；沿用不可变User ID、原Session/Refresh及审计。默认关闭，仅独立test库迁移0097；个人/生产库、既有服务与APK未切换，没有真实短信或邮件发送。生产、本人设备及原生接入仍独立待验。

## 已实现的账号与页面行为

用户先用已有邮箱/手机号验证码或密码登录。在账号与验证中重新验证当前账号，再让浏览器创建通行密钥；新密钥绑定现有UID，不匿名创建账号或合并历史冲突。注册与移除都要求一次新的密码或已验证渠道OTP证明，不直接复用旧Session的authenticatedAt。当前证明固定UID、sid、密码版本/指纹、源标识状态、操作与目标，最长五分钟；刷新、退出、禁用账号、密码/源渠道变化会使证明失效。

支持最多10把活跃密钥，名称、多凭据列表、最近使用与设备报告的备份状态。移除先重新验证，再明确确认；最后一把密钥还需保留可用验证码渠道或可登录的密码别名。撤销密钥、撤销全部Session和审计在同一SQL事务完成，旧Refresh不能复活会话。已撤销credential ID保留唯一归属，不能被另一账号重新绑定。丢失设备后可用既有渠道登录并移除旧密钥；丢失全部渠道的恢复仍未完成。

Beta仍默认邮箱验证码，密码为备用；可信Web环境才显示“使用通行密钥登录”和安全中心管理入口。服务关闭、地址不在可信Origin、浏览器API不可用或原生Android/iOS时不提供可提交的Passkey入口。取消/超时与已保存密钥给出中文重试/备用指导；页面离开或Session变化时不提交迟到的设备响应，服务器已签发的迟到登录会话由客户端尝试撤销。Web令牌目前仍在内存，刷新页面后需要再登录，FIX-16安全持久会话保持待做。

## 协议、存储和事务边界

服务端精确锁定@simplewebauthn/server 14.0.3，支持Node>=20及CommonJS；浏览器精确锁定@simplewebauthn/browser 13.2.2，共用WebAuthn JSON协议。只使用ES256、RS256、EdDSA，注册residentKey与userVerification均required、attestation为none，登录同样强制用户验证。应用不收集或保存指纹、面容原始信息。

0097增加passkey_credentials：原user_id、credential ID完整值与SHA-256唯一索引、公钥、RP ID、签名计数、版本、名称、transports、AAGUID、单设备/多设备及备份标志、创建/最近使用/撤销时间。哈希仅用于精确查找/唯一约束，仍重查完整ID；不按客户端的userId或userHandle选账号。userHandle是由现有不透明UID编码的16字节句柄，只作服务器归属一致性检查。公开登录options不接收任何账号提示；安全中心仅向本人返回管理ID和显示资料，不返回原始credential ID或公钥。

Redis保存随机句柄对应的服务端状态，使用目的隔离的HMAC键、五分钟TTL及CAS一次消费。注册与登录的WebAuthn挑战、当前账号OTP、移除证明彼此隔离，注册options也是单次阶段转换。验签尝试在SQL之前消费挑战，失败、回滚或Redis记录丢失不自动重建。账号/IP入场有限额，嵌套DTO拒绝客户端身份字段并限制二进制编码和扩展大小；Redis请求使用既有连接/命令短截止时间，异常脱敏拒绝。

服务器验证type、challenge、固定Origin/RP ID、用户存在/验证、签名及ID一致性，并主动拒绝跨Origin iframe与topOrigin。登录验签完成后，在原AuthService签发事务内锁用户和凭据，重查有效期、归属、撤销、完整ID、公钥、RP、计数及版本，再更新计数/备份/最近使用、创建原auth_sessions并写审计。行锁等待后重新核对证明及Session期限，共用绑定引擎也补上等待后的证明期限重查。版本每次成功登录递增，合法零计数也能拒绝并发旧快照；同步Passkey的零计数与合法备份状态不被一律判为攻击，非零计数倒退、备份资格变化拒绝。

## 配置与发布/回滚

| 配置 | 策略 |
| --- | --- |
| AUTH_PASSKEY_ENABLED | 默认false，关闭时不读取/要求0097，已有邮箱/密码/手机号继续沿原实现 |
| AUTH_PASSKEY_RP_ID | 固定小写DNS hostname；不接受IP、请求Host或转发头推导 |
| AUTH_PASSKEY_ORIGINS | 最多8个明确完整Origin；必须HTTPS且hostname精确等于RP ID，无通配符、路径或账户信息 |
| localhost例外 | 仅非production NODE_ENV且development APP_ENV，明确配置http://localhost:端口；staging/production禁止 |

先完成本环境备份/恢复及既有0093–0096发布前置，再扩展0097，配置正式RP/Origin与原CORS、验证真实浏览器/密码管理器后有限开启。RP/Origin改变会使原挑战失效，RP改变也不会自动迁移旧设备凭据，应先保持原域名和恢复入口。所有API副本采用同一配置；关闭开关停止新Passkey接口，保留现有会话与全部密码/验证码策略。不要删除新表或唯一墓碑来回滚；既有0095停用号码环境仍不能降级到忽略disabled_at的旧代码。

登录认证只证明身份。付款、群发、删除等高风险行为继续使用原Runtime操作/对象/版本/期限的一次授权，Passkey登录不授予业务执行权。本批未增加将Passkey验证结果作为高风险业务批准的捷径。

## 验证记录

最终完整artifacts/auth-m4-passkey-20261014-04.log全部21文件343项通过，含原299及本批44项；与Mobile460、Config104、Database31、CLI2合计940项，调试重跑不重复累计。新test库lazy_armor_auth_m2_6cf2b838aac84b6b_test的217密码凭据、39条Passkey、23条安全通知及非空短信风险记录共15张认证表实际dump/restore逐表摘要一致，summary为PASSED/code0。

| 验证 | 证据与结论 |
| --- | --- |
| 真实协议/竞态 | Node真实ES256签名和真实SQL/Redis；错误Origin/RP/challenge/type/签名/UV/handle、重放/并发、零计数/备份/倒退、验签后归属/公钥/版本/撤销/用户/期限重查、审计回滚、数量上限/多密钥/最后恢复方式、Redis失败及真实SQL行锁过期均通过 |
| 浏览器 | 04真实Chrome与虚拟认证器：邮箱进入原账号→重新验证添加密钥→Passkey登录同UID→渠道重新确认移除→全部Session失效；注册/登录/移除3张截图与390px无横向溢出已核对。只清除本套隔离限流键以避免阶段间一分钟等待，未取消产品的实际冷却限制 |
| 类型/构建 | auth-m4-typecheck-20261014-02及auth-m4-build-20261014-01：无缓存8/8；最终API修改再用auth-m4-api-build-20261014-04验证，Web03显式development/localhost导出通过 |
| Android | auth-m4-android-20261014-01：development/localhost、清理Metro后Hermes导出通过；原生入口隐藏，无APK安装或本人真机/正式包验收 |
| 仓库与发布门 | hygiene/terminology/data-truth通过；98个迁移分段通过，0083正式发布证据仍缺，migration:safety为exit1；生产依赖审计0 critical/2 high/1 moderate，仍exit1，未新增通过声明 |

03专项44/44及51密码凭据/15表恢复是最终全套之前的独立证据，最终以04为准。新增CI专项覆盖真实签名与SQL/Redis，浏览器有专门本地证据，未宣称远端CI Green。

调试记录保留且不重复累计：01专项37通过/1浏览器跳过；02完整341通过/1浏览器定位器失败，辅助名称包含图标导致开头匹配过严，此轮不作整套或恢复通过；修正定位器后03专项44/44及3张页面截图已目视核对。首轮Mobile459通过/1原Android清单读取5秒超时；02命令参数位置错误未执行测试，03用Vitest两Worker重跑460/460。首个CLI命令指定不存在的Vitest文件未执行，02改为原Node测试入口2/2。所有env、SQL、日志和截图仅在忽略的artifacts，不修改个人/生产数据或真实供应商。

## 当前问题与下一批

本批关闭Web Passkey代码基础缺口。上线仍缺本环境的正式HTTPS/RP和真实密码管理器/硬件设备验收、本人注册/取消/丢失设备恢复旅程、Android Credential Manager/Digital Asset Links及iOS Associated Domains；不会用虚拟认证器代替本人或生产证据。近期再认证目前用已有密码/渠道OTP，未来用Passkey对绑定/安全变更再次验证需要另一个用途和Session范围的独立协议。

手机号正式供应商、短信和通知送达/账单、NAT设备误拦截、人机验证服务、号码重新分配与丢失全部恢复方式仍待。旧密码表停写/Argon2、FIX-16 Web安全持久会话、项目其他真实旅程及0083正式发布证据门保持开放。依赖本批重新审计，仍0 critical/2 high/1 moderate，不宣称Beta、CI或生产发布已完成。

下一切片M4-02：Passkey近期再认证用于账号安全变更的可复用一次证明、Web失败/恢复体验及正式域名接入准备；原生系统接入和真实服务验收分开推进。统一迁移见[实施方案](AUTH_V2_IMPLEMENTATION_PLAN.md)，整体分析见[项目全面检查](PROJECT_AUDIT_2026-10-12.md)。
