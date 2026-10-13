# S0 第二批整改验收：Admin 访客鉴权 · 2026-10-13

关联[执行方案 V1.1](PROJECT_OPTIMIZATION_PLAN_V1_1.md)的 FIX-02。基线 `2427e08`，源码提交 `18ed7c2935b9238eaafcafb7edfe838557ed8d0a`。FIX-02 的页面访客鉴权范围 CLOSED；S0 整体及正式发布仍未关闭。

**问题与结果**

原 Admin 页面不验证访问者，而是用 ADMIN_ACCESS_TOKEN 为每个访客代理7个诊断接口。配置有效共享令牌且页面可达时，普通访客能看到运维数据；原报告未证明已经公网暴露。

现在每个访客须登录已有管理员账号。API 新增只读 `/api/admin/session`，沿用原 AuthGuard、RolesGuard、JWT 和 SQL auth_sessions；返回最小当前身份，允许 active 的 super_admin / operations_readonly。角色来自 SQL 而非 JWT，当前角色/状态及会话撤销每次重查。普通账号不会注册、提权或取得后台 Cookie。

页面在身份验证通过后读取原7个接口，原审计保留；无 Cookie、伪造、过期、撤销、禁用和降权会话不读取诊断。读取途中任一接口401/403丢弃整份快照；诊断503仍作为单个分区不可用。旧 ADMIN_ACCESS_TOKEN 无论是否残留都不再授权访客。

**会话与配置**

- 登录/退出通过服务端 POST 处理，密码与令牌不进入 HTML、网页脚本、浏览器响应 JSON 或 localStorage。令牌只保存在 HttpOnly/SameSite=Strict Cookie；公开 HTTPS 使用 Secure、Path=/、无 Domain 的 __Host- Cookie，本机 HTTP 用不同 local Cookie 名。
- ADMIN_PUBLIC_ORIGIN 是确切信任来源。生产运行须显式配置，公开服务须 HTTPS；本机回环 HTTP 允许开发/本地生产构建验收。Host/X-Forwarded-Host 不构成授权。Origin 缺失、null、跨站或相似域名拒绝。
- ADMIN_API_URL 只接受 HTTPS 或本机回环 HTTP 的 origin，拒绝嵌入凭据、路径、query/hash；请求禁止重定向，避免向重定向目标转发令牌。真实 HTTP 重定向测试确认目标请求数0。
- 原生表单采用 Referrer-Policy=same-origin；Chromium 中 no-referrer 会使表单 POST Origin 变成 null。浏览器复现并验证修复，Origin 校验没有放宽。页面/认证响应 no-store，增加 DENY 防嵌入和 nosniff。
- 登录体按流累计最多4096字节，不信任仅 Content-Length；验证邮箱、密码长度、重复及未知字段。原 API 登录限流保留。
- 新登录候选必须先通过角色检查，拒绝时尝试撤销刚创建的会话；成功替换会话时尝试撤销旧会话。退出调用原 API 撤销，再清除两个 Cookie；API 失败时仍清除浏览器凭据并显示未确认撤销。
- Admin 会话最长15分钟，不自动刷新。消费者 PC 持久会话与刷新轮换是 FIX-16，未在本批关闭。运行示例见 [Admin README](../../apps/admin/README.md)。

**最终证据**

| 检查 | 结果与本地证据 |
| --- | --- |
| Admin 单元/真实重定向 | 2文件50/50，artifacts/optimization-s0-admin-unit-r3.log |
| 原 API 会话/角色 | 8/8，包含无令牌、伪造、普通用户、两种管理员、SQL降权、禁用、签名过期及撤销 |
| 实际 Next HTTP + 浏览器 | 10/10，与上述8项合计18/18；artifacts/optimization-s0-admin-isolated-r4.log |
| 正常浏览器 | Chrome实际打开匿名页→登录管理员→Dashboard→退出→重新访问仍要求登录；document.cookie无法读取会话，localStorage为空，两个Cookie均HttpOnly/Strict，退出均删除 |
| 读取边界与审计 | 匿名/非法/普通/失效访客新增诊断读取审计0；两个合法管理员分别产生原7项读取审计；HTML没有访问/刷新令牌 |
| Admin 类型与构建 | 类型通过；最终Next实际生产构建通过，artifacts/optimization-s0-admin-build-r2.log，页面/登录/退出均动态服务端处理 |
| API 类型与构建 | 通过，artifacts/optimization-s0-admin-api-typecheck-r1.log、optimization-s0-admin-api-build-r1.log |
| 其他门 | 新文件纳入hygiene后通过；术语/data-truth/diff检查通过；CI YAML解析通过，接入Admin单元和原API权限集成回归 |
| 视觉检查 | 已打开并核对artifacts/optimization-s0-admin-browser-r4.png；管理员身份/退出入口及既有诊断布局正常 |

最终相关回归 **68项（50+18）**，重复轮次不累计。初轮测试夹具遗漏 UUID_TO_BIN，修正后 API/HTTP 通过；浏览器暴露的 Referrer 策略兼容问题也已修复，最终 r4 全通过。

实际验收仅使用新库 lazy_armor_admin_session_3398a8e7357f45bd_test（MySQL3311），完成93条既有迁移；Redis6391/15使用独立随机前缀。测试账号仅在该新库中创建/赋予角色，没有访问个人3307数据库或更改真实管理员。模型调用关闭，日志、截图、测试凭据和测试库保留为私有证据，不同步 GitHub。

截图中的 Worker DOWN/unknown 是隔离验收只启动 API 的实际状态，不代表生产 Worker 故障，也没有用示例数据伪造健康。此轮为浏览器/真实服务的隔离fixture验收，公开HTTPS/TLS代理和生产账号/环境仍须实际部署验证。

CI默认执行单元及8项API权限检查；Next子进程/浏览器10项需显式运行隔离脚本。推送开发分支不等于远端CI Green，本批没有声称正式发布通过。

**当前分析与下一切片**

可构建、备份目标保护、Connector合同与Admin页面鉴权已分别按冻结范围收口。仍须优先处理 FIX-04 生产依赖告警；原审查为2 critical / 5 high / 1 moderate，本批未升级依赖或重新审计，不能把旧数量当作新扫描结果。

正式0083迁移/批准证据与FIX-13非空恢复矩阵继续待验。密码重置并发、邮箱身份一致性、failed Job恢复、锁序及健康/授权分离仍开放；手机同账号刷新保留草稿、Web确认和消费者PC会话也未修复。当前仍是开发检查点，不具备正式发布条件。下一实施切片：**FIX-04 依赖处置与受影响路径回归**。

零新SQL迁移、执行权威或生产部署。回滚可撤回源码提交恢复旧代码，但旧Admin访客暴露问题会重新出现，公开服务必须同时停止开放。无需修改个人数据或历史迁移。
