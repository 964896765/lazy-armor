# Auth V2 · M2-02 新邮箱安全绑定

日期：2026-10-13。基线 c5425d68，codex/v83-persistent-runtime。本批新增当前账号与新邮箱的双证明绑定，保留原 User ID、业务资料与旧登录方式；完整 M2、手机号绑定/换号、Passkey 和生产发布分别待验。

2026-10-13后续：[M2-03统一邮箱恢复](AUTH_V2_M2_EMAIL_RECOVERY.md)已实现BOUND模式的新增邮箱密码恢复与旧链接隔离。下文“恢复尚未实现/下一优先项”为M2-02当时的范围，默认LEGACY兼容模式仍不支持别名恢复；以M2-03的灰度与验收条件为准。

## 已实现的行为

安全中心按服务端实际能力显示“添加登录邮箱”。用户输入新邮箱，先用当前密码或当前账号已验证渠道的验证码确认身份，再验证新邮箱。未设置密码的邮箱/手机号账号可以直接使用已有渠道，无需先设置密码。新邮箱验证码登录与 UNIFIED 密码登录进入原账号；目标、记忆、记录、订阅和设备归属不迁移。

旧 /auth/identifiers/bind/request、/confirm 保留为“验证本人旧账号邮箱”，不改变其历史语义。新增邮箱不能抢占已有 login_identifiers 或 auth_identities 中的邮箱；历史已验证或未验证账号均不自动合并。新增绑定不会把未验证旧邮箱提升为恢复渠道。

本批只添加登录邮箱。新邮箱作为忘记密码的恢复收件地址尚未实现，当前恢复仍使用原 canonical、已验证旧邮箱；界面不宣称新邮箱已可用于完整账号恢复。下一认证切片补齐恢复标识、凭据版本及旧恢复链接失效约束。

## 接口与证明

| 接口 | 输入/条件 | 结果 |
| --- | --- | --- |
| GET /auth/security/methods | 服务端已验证 Session | emailBinding.available 与可发送验证码的已有渠道 id、kind、masked；不返回原地址、hash 或证明 |
| POST /auth/email-binding/start | 新邮箱、proof=password + password，或 proof=code + identifierId | 600 秒随机 challenge；密码成功进入 target，渠道证明进入 current 并发送当前渠道 OTP |
| POST /auth/email-binding/current/confirm | challenge + 当前渠道 6 位 OTP | 原子提升同一挑战至 target；不能重复验证或跨用途消费 |
| POST /auth/email-binding/target/request | 已完成当前证明的 challenge | 发送新邮箱独立用途 OTP，300 秒有效 |
| POST /auth/email-binding/confirm | challenge + 新邮箱 OTP | 原子消费 OTP 与 challenge，再以同一 SQL 事务新增 verified identifier 和成功审计 |

User ID 与 sessionId 只来自服务端 JWT/SQL 会话校验，客户端额外指定用户、会话或后续替换目标会被拒绝。JWT 校验同时检查 SQL Session 未撤销且未过期。挑战冻结 user、session、target、当前密码快照与版本（无密码状态也冻结）和源渠道归属/验证状态。刷新轮换 sid、退出、会话到期、账号禁用、改密、凭据版本变化或新增初始密码都会使旧证明不可用。

Redis 使用随机 256 位挑战的 HMAC key，仅保存服务端上下文及密码快照的 HMAC 指纹，不保存密码/hash/验证码，也不将这些字段返回客户端。验证码用途区分 login、旧邮箱验证、设置密码、email-bind-current 和 email-bind-target；新挑战还绑定会话、目标、凭据状态与随机 challenge。旧匿名登录 OTP key 与已有 M1 scope key 保持兼容。

目标/账号验证码发送预算跨用途共享；当前密码证明按用户/IP 限流，OTP 按挑战/IP 限制尝试次数。正式邮件/短信由既有 HTTPS delivery 配置发送，禁止重定向与测试/生产降级到控制台。Redis/限流/内部数据库失败返回脱敏错误并停止操作。

## 事务、并发与失败重试

最终写入采用已有 authTransaction、RR 与 login_identifiers → auth_identities 缺键/唯一索引锁顺序，与匿名 OTP 建号和密码注册串行核对。事务中再锁当前用户/会话并重查凭据指纹与源渠道归属，新增登录标识和 LOGIN_EMAIL_BOUND 成功审计同事务。无法获得当前证明或目标被占用时，不改变原账号或其他账号。

Redis 消费在 SQL 事务前完成，外部验证码操作不进入可重试数据库事务。数据库短暂死锁由原事务重试；最终失败或审计回滚时不会留下绑定或成功审计，已经消费的证明不复活。用户需重新开始，重新完成当前账号和新邮箱验证。发送失败会清除目标 OTP，仍遵守共享发送冷却；界面提供重新开始入口。

客户端 challenge 仅存在本页内存，不写入 SecureStore、浏览器持久存储或 URL。令牌/账号变化、过期或离开页面后清理证明；异步晚到响应不能推进其他账号/会话的绑定步骤。成功后清理密码与验证码并刷新安全中心。

## 部署与回滚

AUTH_EMAIL_BIND_ENABLED 默认 false。启用要求 AUTH_PASSWORD_CREDENTIAL_MODE=UNIFIED、0093 已执行且新旧凭据审计/回填通过，以及邮箱验证码服务实际可用；否则拒绝启用或不显示入口。本批没有新增 SQL，没有修改或执行个人库迁移。

发生问题可关闭新增绑定开关并保留 UNIFIED 登录解析和已绑定标识。已向用户开放别名后，直接退回 LEGACY/SHADOW 会使别名密码登录失去能力，不作为保持同等登录体验的回滚；不能删除绑定标识或恢复制造重复账号的旧解析。生产备份/恢复、供应商和本人真机验收独立收取。

## 验证与当前分析

最终验收以 artifacts/auth-m2-bind-20261013-04.log 为准，调试及重复运行不重复计数。故障注入只使用 MySQL3311 新建精确 test 库 lazy_armor_auth_m2_5cdb67de55b64ab8_test 和 Redis6391 随机前缀，根 .env 的个人库不用于测试。

| 验证 | 最终结果与范围 |
| --- | --- |
| 联合 API/SQL/Redis/真实 Chrome | 8 个测试文件、109 项通过，无未处理错误；其中新绑定集成33项、启动开关3项，其余73项验证原认证路径 |
| 移动端 | 72 个文件、441 项通过；最终页面变更后重验 |
| 配置/数据库/危险CLI守卫 | 65 / 31 / 2 项通过；总计648项 |
| 类型与构建 | 八包 typecheck/build 均8/8通过，各4包使用缓存；API/Mobile最终源码变化后分别重验类型及构建 |
| Android | 最终页面的 Android/Hermes bundle 导出通过；无新APK、安装或本人真机验收 |
| 隔离CLI回填 | 首次复制2个原hash、重跑新增0；原账号/角色/密码/会话摘要不变 |
| 非空恢复 | 52个用户密码凭据及9张账号认证表实际dump/restore，全部行摘要一致；备份使用hex-blob保护BINARY UUID |
| 仓库与CI | 术语、数据真实性、暂存diff/卫生、CI YAML检查通过；新增绑定回归接入CI，不声称远端CI Green |

真实 Chrome 使用最终Web产物和真实 Nest/SQL/Redis，在390像素宽度完成当前密码→新邮箱、已有邮箱OTP→新邮箱两条旅程；两个新浏览器会话分别用新邮箱密码和新邮箱OTP进入原User ID。无密码账号的安全中心仍显示未设置密码，新增和原邮箱均显示已验证，无水平溢出。截图与阶段记录保存在忽略目录 artifacts/auth-m2-bind-browser-20261013-04，已视觉核对。

覆盖跨用户/会话/用途/目标、未验证源邮箱、过期/重放、refresh/logout/禁用/SQL会话到期、凭据版本与首个密码变化、源归属变化、并发绑定与匿名OTP抢占、审计回滚、最终写入重查、发送/尝试预算、Redis/限流故障与脱敏。邮件/短信均由HTTPS测试网关fixture接收，仅用于验证协议和失败行为，不是正式供应商送达证据。

当前分析：认证方式正在归并为同一账号，新增邮箱双证明切片已具备自动/隔离和浏览器证据；整体仍处于受控Beta。新增邮箱的密码恢复是下一优先项，否则用户虽然可以验证码进入原账号，却可能无法在忘记原密码时更新可选密码。该恢复切片应绑定具体已验证渠道、凭据版本及单次token，禁止复活未验证旧邮箱的恢复链接。

仍开放：新邮箱密码恢复、手机号绑定/换号与真实短信供应商、Passkey、Argon2id、旧密码表停写/收缩、Web 安全持久会话/BFF、个人/生产0093与受控切换、本人真机与长期旅程。历史依赖 2 high/1 moderate 与0083正式 destructive 发布证据门继续开放；本批不能据此宣布完整 Auth V2/Beta/发布已完成。
