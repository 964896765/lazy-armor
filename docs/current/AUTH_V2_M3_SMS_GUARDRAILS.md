# Auth V2 · M3-02 短信预算、网关契约与故障恢复

日期：2026-10-13。基线3ca4f304，分支codex/v83-persistent-runtime。本批实现正式短信入口的持久额度、发送间隔、费用预留、网关回执验证和请求故障时限，保持原User ID、认证Session、绑定证明及Runtime敏感操作审批。0094只在独立test库执行；个人和生产库未迁移，真实短信默认关闭。

## 实际行为

真实短信通过SMS_LOGIN_SEND_ENABLED独立开启，默认false。配置完整且0094可读后，才向客户端报告phone验证码CONFIGURED；这表示网关契约已配置，不表示运营商送达。原开发控制台仍仅在明确development且无配置网关时使用，本地控制台不开放手机号安全绑定。

手机号规范为+86和大陆11位号码。所有短信用途共享同一号码、IP、通道额度及号码发送间隔，不能通过切换登录/邮箱绑定/手机号绑定绕过。数据库UTC时钟决定发送预留时间与中国时区自然日，应用时钟或固定窗口变化不能重置号码间隔。午夜只重置每日额度，号码间隔继续保留；等待行锁跨日时回滚旧日事务并重新核对。

| 控制 | 默认值与作用 |
| --- | --- |
| 号码间隔 | 两次发送预留至少60秒，独立于固定窗口与验证码用途 |
| SMS_LOGIN_PHONE_DAILY_LIMIT | 每号码每日5次 |
| SMS_LOGIN_IP_DAILY_LIMIT | 每IP每日20次；原10次/600秒短期预算同时保留 |
| SMS_LOGIN_GLOBAL_DAILY_LIMIT | 整个短信通道每日100次 |
| SMS_LOGIN_MAX_UNIT_COST_FEN | 单次最高预留10分人民币 |
| SMS_LOGIN_DAILY_BUDGET_FEN | 每日最高预留1000分人民币，即10元 |

默认费用值是上线前必须按供应商报价重新核对的保守配置，不代表采购价格。网关必须在真实发送前确认签名、模板、计费片数与费用上界；拒绝超过maxCostFen的请求。应用始终扣最高预留，不依据较低回执释放差额。供应商结算、账户硬额度和实际短信送达仍需独立验收。

## 持久数据与并发

0094新增auth_sms_quotas和auth_sms_attempts，原账号、资料、订阅与凭据表不重建。额度按固定环境namespace、日桶/interval桶、维度及subject_key唯一；顺序锁定通道、号码间隔、号码日额度、IP日额度，核对后同事务累计次数/最高费用并创建RESERVED发送记录。并发节点共享同一数据，服务重启或Redis丢失不会释放SQL日预算。拒绝请求全部回滚，不留下新额度或发送记录。

SMS_LOGIN_QUOTA_SECRET是独立、稳定的至少32字符密钥，用于号码/IP/供应商ID的HMAC化，JWT换钥不重置短信额度。表内不保存原始号码、IP、验证码或网关令牌；网关通过本系统的请求UUID核对记录。生产namespace与密钥须跨API实例一致，不通过改namespace/密钥清空额度。

外部HTTP只在预留事务提交后调用，不能放入SQL重试事务。状态为RESERVED、ACCEPTED、UNKNOWN或CANCELLED；ACCEPTED是网关受理，非送达。HTTP失败、超时、非法/超价回执均记UNKNOWN，继续占额度；不自动重发或退款。SQL预留2秒超时后不发短信，迟到事务可能留下保守RESERVED记录，供核对使用；禁止据此推断已发送。

## Gateway V2 接口契约

POST SMS_LOGIN_DELIVERY_ENDPOINT必须HTTPS，禁止重定向和URL内嵌凭据。使用Bearer LOGIN_CODE_DELIVERY_TOKEN（至少32字符）和Idempotency-Key请求UUID。正文保留type=login_code、channel=phone、recipient、code、expiresIn，并增加contractVersion=2、requestId、templateId、budgetDay和maxCostFen。

允许purpose：login、email-bind-current、phone-bind-current、phone-bind-target。客户端不能选择purpose、价格、配额、namespace或用户ID。SMS_LOGIN_TEMPLATE_ID只能是网关已审核模板的标识；这套接口不能发送任意营销内容。

成功响应示例：

```json
{"accepted":true,"requestId":"原请求UUID","providerRequestId":"供应商不透明标识","costFen":3}
```

网关须持久化请求UUID并对同一Idempotency-Key去重，前置校验号码发送间隔/预算日/报价/模板后再调用供应商；costFen是网关确认的费用上界，不替代最终账单。应用校验accepted、匹配requestId、合法providerRequestId及整数costFen≤maxCostFen；不接受仅HTTP 2xx或旧空回执。字段不合法、迟到回执或结果未知均不签发新验证码。正常API只返回sent、GATEWAY_ACCEPTED、等待时间与有效期，不返回验证码、请求UUID、供应商ID或成本。

真实短信先确认网关回执和记录状态，再写验证码HMAC；有效期扣除本次发送耗时。原邮箱和M2字符串OTP保持兼容，验证码单次消费及每条5次上限保留。

## 故障边界与页面

限流、OTP和绑定证明的请求Redis客户端使用连接/命令1秒时限、有限重试并关闭离线队列；异常后断开旧连接，以免迟到回包破坏下一次请求。Worker队列仍使用自己的连接策略。限流次数及首次TTL原子写入，窗口计数/TTL一次返回。Redis故障返回脱敏503，不等待恢复后补执行原请求。

网关请求和响应体共用4秒截止时间，包含响应体挂起；迟到结果不写新OTP、不变更UNKNOWN为ACCEPTED、不补发。SQL状态记录另设1秒时限。模块仅在显式开启短信时检查新表，默认关闭的旧库不因缺0094停止原邮箱服务。

客户端读取原安全错误协议的retryAfterMs，按服务器等待时间禁用重发；日额度以小时/分钟显示，避免上万秒提示。短信成功显示“短信请求已受理”，提供邮箱/密码备用引导。切换手机号/邮箱清理原渠道等待状态，短信额度耗尽不阻断邮箱；真实浏览器验证已绑定邮箱进入原User ID，不创建替代账号。手机号安全绑定仍按实际能力显示，两次证明和高风险操作独立授权保留。

## 构建、灰度与回退

EXPO_PUBLIC_API_URL已加入Turbo缓存输入，Mobile Web构建在缓存未命中时清理Metro缓存，防止不同API目标复用旧包。隔离浏览器先用真实Chrome检查导出页面和localhost API目标，失败时在创建test库前退出。隔离Web/Android导出显式development及localhost目标；生产包仍须真实HTTPS地址，不能发布本批测试目标。

上线顺序：本环境备份与恢复证据 → 0094 → 确认稳定namespace/额度密钥 → 网关V2、模板与报价验证 → 限制费用灰度 → 真实大陆运营商送达 → 再开放手机号绑定/推广。关闭SMS_LOGIN_SEND_ENABLED停止新请求并再次检查预留后开关；已在途请求可能完成，合法已签发匿名登录OTP仍可消费，既有登录Session/密码保持原策略。目标为手机号的未完成绑定会随能力关闭停止继续，需重新开启后重新核对。

禁止降级到无预算的旧短信实现、删除额度或退款未知发送。历史备份恢复后必须先停短信，再依据网关/供应商记录重建缺失费用预留；恢复行摘要一致不证明费用不会重放或超额。额度/尝试记录的正式留存与清理、账单对账需要运营方案。

## 验收与当前分析

日志、SQL、截图及env仅保存在忽略的artifacts中。所有发送为HTTPS fixture，未联系真实供应商或号码；SQL仅MySQL3311独立test库，Redis仅6391随机前缀，网络故障使用专属本机代理，不中断个人服务。

| 验证 | 最终结果及范围 |
| --- | --- |
| 原认证联合回归 | artifacts/auth-m3-sms-20261013-02.log中原12个认证文件206项通过；新增备用邮箱浏览器用例当时有fixture SQL错误，不把整次运行写作全通过 |
| 本批专项收口 | artifacts/auth-m3-sms-20261013-04.log四文件37项全通过：SMS集成/Chrome22、启动4、真实Redis网络故障2、共用Provider/加权限流9；与原认证不重叠，合计API243项 |
| Mobile/Config/Database/CLI守卫 | 448 / 73 / 31 / 2项通过；与上述API合计797项，重复调试和聚焦重跑不重复累计 |
| 类型与构建 | 全仓各8/8、无缓存通过；末次连接重建修改后API类型及构建再验通过 |
| 前端构建与缓存 | API地址改变使实际Turbo任务hash改变；隔离Chrome预检查通过，生产缺HTTPS配置仍拒绝启动；测试目标明确为development/localhost |
| Android | artifacts/auth-m3-sms-android-20261013-03显式测试目标、清理Metro后Hermes导出通过；无新APK、安装或本人真机验收 |
| 迁移、回填与非空恢复 | 0094在新test库lazy_armor_auth_m2_b3d463eb3b604a29_test执行；CLI回填首次2/重跑0且原账号/hash/Session摘要保持；2个密码凭据和11表（含非空短信预算/尝试）实际hex-blob dump/restore摘要一致 |
| 发布前源码检查 | 暂存diff、仓库卫生、术语、数据真实性、CI YAML与95迁移分段通过；0083正式证据门仍失败，不声称生产或远端CI已通过 |

重点覆盖：跨用途并发只有一次预留、号码/IP/通道日额度与费用边界、应用时钟变化不能绕过间隔、午夜保留间隔及跨日事务重算、重建服务/清除Redis后SQL预算仍有效；拒绝/错请求ID/超价/坏JSON、4秒迟到/挂起回执、停发竞争、真实SQL锁等待和Redis暖/冷连接黑洞不补发。浏览器完成“短信额度耗尽→切换已绑定邮箱→同一User ID”，截图已保留；原邮箱/手机号双证明与恢复旅程通过。

当前账号和费用基础已形成，但供应商签名/模板实际审核、计费一致性、真实运营商送达、设备异常/人机验证和通知收据仍待。下一批M3-03推进安全换号的已有账号与新号码双证明、原渠道通知/会话策略；丢失所有渠道的恢复和号码回收不得自动转移其他账号。Passkey、旧密码表停写/Argon2、消费者Web安全持久会话及原Beta现实验收仍未完成。

0094是新增表的前向迁移；95个迁移的Drizzle分段检查通过，原0083正式destructive migration证据门仍exit1，不能以本批隔离迁移替代正式发布。前批依赖0 critical/2 high/1 moderate保持开放。完整方案见[统一认证实施方案](AUTH_V2_IMPLEMENTATION_PLAN.md)，全项目历史检查见[全面分析](PROJECT_AUDIT_2026-10-12.md)。
