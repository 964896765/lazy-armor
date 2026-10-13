# 懒人装甲 Auth V2.0 · 统一认证与迁移执行方案

基线：2026-10-13，codex/v83-persistent-runtime。目标市场：中国大陆为主。Beta邮箱基础、M2-01用户级密码兼容迁移与M2-02新邮箱双证明绑定切片已实现；手机号生产推广和Passkey尚未完成。

## 产品与账号原则

一个不可变的 users.id 管理所有 Goal、Memory、Plan、Resource、History、订阅与设备。手机号、邮箱、密码、Passkey 仅是凭据。保持原 User ID 与原 Runtime 风险/审批/核验权威；登录成功不授予付款、群发、删除等执行权限。

Beta 默认邮箱验证码，密码是已登录用户主动添加的备用方式。旧密码注册页面转入验证码入口，旧 API 保留兼容。中国大陆手机号入口保留真实发送可用性；短信供应商、限流、绑定/换号及验收完成后才切为手机号优先。Passkey 只显示后续规划，不提供假按钮。

## 实施与迁移阶段

| 阶段 | 具体工作与数据库 | 接口及产品行为 | 上线条件 |
| --- | --- | --- | --- |
| M0 只读审计 | 规范化邮箱/手机号，比较 auth_identities 与 login_identifiers；统计跨 User ID 冲突、非规范值、未验证旧邮箱 | 私有清单只包含聚合与加盐指纹，不导出密码/hash/token | 每个环境单独取快照；冲突需本人证明与人工核对 |
| M1 Beta 基础（已实现） | 复用原表及唯一索引；事务统一身份解析，密码注册不虚构邮箱验证；不新增迁移 | 合并 OTP 登录/注册、当前账号验证邮箱、可选初始密码、真实安全状态；重置/改密原子撤销会话 | SQL/Redis 并发、事务失败回滚、账号冲突与客户端刷新回归；Web 实际交互 |
| M2 凭据解耦（M2-01/02已实现，整体待续） | 0093新增password_credentials，user_id唯一；bcrypt参数/version/source保留；原hash复制，不改User ID；M2-02零新SQL | LEGACY默认兼容、SHADOW核对/事务双写、UNIFIED已验证手机号/邮箱共享密码；新邮箱以当前账号/新邮箱双证明添加 | [M2-01](AUTH_V2_M2_PASSWORD_CREDENTIALS.md)、[M2-02](AUTH_V2_M2_EMAIL_BINDING.md)；别名恢复/旧表停写待实施，生产迁移与切换待验 |
| M3 国内手机号（待实施） | 复用 login_identifiers 的 phone 唯一映射；增加绑定/换号挑战和安全变更记录，禁止自动合并 | 已登录账号证明当前身份 + 验证新手机号；冲突停止；换号前通知旧渠道，撤销/复核敏感会话 | 正式短信、真实运营商送达与费用限制、设备异常规则、绑定/换号/丢失号码恢复旅程 |
| M4 Passkey（待实施） | passkey_credentials：user_id、credential_id 唯一、public_key、sign_count、transports、AAGUID、备份标志、created/last_used/revoked；不保存生物信息 | WebAuthn 注册与登录 options/verify；原 session 与审计；用户可管理多把凭据 | 固定可信 RP ID/Origin、HTTPS；Web→Android Credential Manager→iOS，分别验收 |

M1当时零新SQL。后续M2-01在Schema中增加password_credentials和0093前向迁移，仅新隔离test库执行；Passkey等其他新表仍为设计。正式迁移、全量回填与切换仍必须有本环境的备份/恢复、失败注入及独立发布证据。

## M1 当前接口与证明

| 接口 | 身份与证明 | 结果 |
| --- | --- | --- |
| POST /auth/code/request、/verify | 匿名，一次性验证码；原登录 Redis key 保留 | 新身份创建一个普通用户；已验证身份复用 User ID |
| POST /auth/login | 原邮箱与密码，账号/IP 限流，事务内重查已比较的 hash | 原会话；密码已变化/身份冲突则不能签发 |
| GET /auth/security/methods | 当前 Session | 脱敏标识及实际 verified/password 状态 |
| POST /auth/email-binding/start、current/confirm、target/request、confirm | UNIFIED + 默认关闭的绑定开关；当前密码或已验证渠道 + 新邮箱OTP；绑定用户/Session/用途/目标/凭据版本 | 新登录邮箱进入原User ID，目标被占用拒绝；暂不扩展忘记密码的恢复收件地址 |
| POST /auth/identifiers/bind/request、/confirm | 当前 Session + 原账号邮箱 + 当前密码 + email-bind 用途、用户绑定 OTP | 仅验证本人已有旧邮箱；不支持绑定任意新邮箱或合并账号 |
| POST /auth/password/set/request、/set | 当前 Session + 本账号已验证邮箱 + password-set 用途、用户绑定 OTP | 在同一 User ID 添加首个可选密码；已有密码必须走改密 |
| POST /auth/change-password | 当前 Session + 旧密码 | 密码更新、重置 token 失效、所有 Session 撤销及审计同事务 |
| POST /auth/forgot-password、/reset-password | 已验证的原邮箱渠道；单次、未过期的恢复 token | 条件原子领取 + 改密 + 全会话撤销 + 审计；失败全部回滚 |
| POST /auth/refresh、/logout | 原 Refresh Token、原会话家族 | 轮换、重用检测、撤销；不改变业务授权 |

旧未验证邮箱不能仅因收到了邮件就成为账号恢复渠道。忘记原密码且没有可信恢复方式的旧用户需支持核对；本批没有实现自动恢复或人工管理工具。已存在但未经邮箱验证的旧恢复链接也拒绝使用。历史冲突不静默覆盖、转移、合并数据。

规范化：邮箱 trim/lowercase、最大 320 字符；中国大陆手机号规范为 +86 与合法 11 位号码。对历史非规范记录先审计后制定映射修复，不能直接批量覆盖。

所有新增密码必须至少 10 位且不超过 bcrypt 的 72 UTF-8 字节容量，避免忽略后缀；旧密码登录仍保留原兼容上限。Argon2id 切换属于 M2 独立工作。

## 验证码与会话

验证码为随机 6 位，HMAC 存储、300 秒 TTL、Redis 原子单次消费。登录、旧邮箱验证、初始密码用途互不接受；非登录用途绑定服务端 CurrentUser，客户端不能选择用户 ID。发送账号/IP预算跨用途共享；失败删除挑战，HTTPS 发送拒绝重定向。当前发送和尝试预算使用固定窗口，客户端提供 60 秒重试提示；正式短信需增加严格发送间隔、日额度、设备异常和供应商费用熔断。

LOCAL_DEVELOPMENT 仅允许开发环境并明确显示控制台发送，测试/生产禁用；发送 code/token 不出现在正常 API 回包中。生产 provider 不可用时失败关闭，不回落到控制台。

密码重置、改密、Session 创建/轮换按同一用户行锁协调。密码比较和 bcrypt 在事务外，签发时重查该次证明的原 hash，避免重置后旧密码请求补发会话。死锁/锁等待/唯一竞争最多三次重试，仅包含数据库与事务审计。

客户端明确登录、退出或账号变化时重建账号查询缓存；透明 Refresh 保持 sessionScope、可信设备及聊天草稿。并发存储写串行化，晚到刷新不能复活旧账号。userId 返回值仅作客户端隔离信息，服务器授权始终由已验证 Session 决定。原生继续 SecureStore；消费者 Web 的持久安全会话/BFF（FIX-16）仍待完成。

恢复邮件的 lazyarmor://auth/reset-password 深链接入真实密码重置表单；已有会话也允许打开该恢复路由。忘记密码申请保持统一回包；自动恢复仅适用于已验证邮箱，未验证旧邮箱的支持核对不由这个表单绕过。恢复发送要求HTTPS且禁止重定向。

## M3 手机号与账号恢复

正式服务采用经签名/模板审核的短信供应商适配器，配置 secret 仅在服务端。先灰度真实中国大陆号码，记录送达延迟/失败率与日费用，限制号码/IP/设备/日额度并在异常时增加挑战或暂时阻断。日志和供应商回执脱敏。

新增绑定必须当前身份与新渠道双证明；换号需验证旧渠道或强凭据并验证新号。旧渠道不可用时走独立恢复，不能把“收到新号短信”视为旧账号所有权。已归属其他 User ID 的号码不得自动绑定；号码回收问题需要恢复保护、通知与敏感操作延迟规则。

账号合并是独立受控项目：证明两个账号、核对订阅/订单/授权冲突、制定各业务表迁移与审计/回滚，不允许按邮箱相等自动合并。

## M4 Passkey 与独立操作授权

服务端生成短期随机 challenge，绑定注册/登录用途；注册还绑定当前用户、当前会话及近期强身份确认。严格检查 challenge、RP ID、Origin、type、签名、userVerification 与凭据归属，挑战仅能消费一次；不能相信客户端传来的 userId。

Web 先用成熟 WebAuthn 校验库；Android 配置网站与包/签名 Digital Asset Links，iOS 配置 Associated Domains。支持同步 Passkey 的备份标志与合法零计数，不能简单把 sign_count==0 判为攻击。新凭据注册、删除最后恢复方式或敏感安全变更需要近期强确认与审计。

高风险操作授权始终引用原 Runtime 的具体操作/金额/对象/范围/版本、有效期及一次性确认。Passkey 的强认证结果证明人，不能代替业务审批。没有独立授权的支付、群发、删除仍拒绝执行。

## 灰度、回滚与待验

先部署安全的统一解析，关闭未验凭据入口；真实历史映射审计通过后开放本人验证与可选密码。M2 新表双读期间比较 owner/算法版本，差异停止切换。每阶段配独立 feature flag、兼容窗口、审计与恢复步骤。

不能回滚到会重新创建重复账号的旧实现。出问题时停止新注册/绑定/改密入口，保持安全读取和合法原会话，修复或向前恢复；不改 User ID、不删除旧账号、不自动转移资源。

验收分开记录：隔离自动回归、真实邮件/短信/设备、历史库修复、生产迁移、正式发布。现存 2 high/1 moderate 依赖和 0083 发布证据门继续开放。完整 Auth V2 不因 M1 完成而关闭。

M1具体结果见[第四批验收](OPTIMIZATION_BATCH_04_AUTH.md)，密码凭据切片及611项回归/非空恢复见[M2-01记录](AUTH_V2_M2_PASSWORD_CREDENTIALS.md)，新邮箱绑定与本批验收见[M2-02记录](AUTH_V2_M2_EMAIL_BINDING.md)。下一认证切片为统一已验证邮箱恢复、凭据版本及旧链接失效约束，随后推进正式短信/换号；完整Auth V2仍未关闭。
