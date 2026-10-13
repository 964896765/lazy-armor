# Admin 登录与运行

Admin 复用 API 的密码登录和原 auth_sessions，仅允许 active 的 super_admin / operations_readonly。普通用户不能访问运维数据，访问页面不会创建账号或授予管理员角色。管理员账号需要已经具备密码登录身份。

本地 PowerShell 示例（先启动 API）：

```powershell
$env:ADMIN_API_URL = 'http://127.0.0.1:3001'
$env:ADMIN_PUBLIC_ORIGIN = 'http://127.0.0.1:3002'
pnpm --filter @lazy-armor/admin dev
```

用浏览器打开配置中的确切 origin。localhost 与 127.0.0.1 是不同 origin；协议、主机和端口必须匹配。生产构建运行时必须显式设置 ADMIN_PUBLIC_ORIGIN；公开部署必须 HTTPS，API 地址也只接受 HTTPS 或本机回环 HTTP。两项配置均只接受 origin，不接受账号密码、路径、查询参数或 fragment。TLS 代理保持浏览器 Origin，不能用任意 Host/X-Forwarded-Host 推导信任。

登录/退出使用同源 POST。令牌仅在服务端请求和 HttpOnly/SameSite=Strict Cookie 中传递；HTTPS 使用 Secure 的 __Host- Cookie，本机 HTTP 使用独立 local Cookie 名。会话最长15分钟，不自动刷新；到期重新登录。ADMIN_ACCESS_TOKEN 已停用，残留配置不会授权任何访客，不要再配置共享管理员令牌。

每次页面请求都由 API 校验签名、有效期、SQL 当前账号状态/角色以及会话撤销。通过后才能调用原7个诊断接口，原读取审计保留；读取途中401/403丢弃整份快照。认证服务不可用时不读取诊断，普通诊断503保留分区不可用状态。

退出会调用原 API 撤销会话，并删除两个 Cookie；撤销服务失败仍清除浏览器凭据，并显示未确认服务端撤销。Cookie 随短会话到期删除，服务端会话记录按原 API 生命周期处理。自动刷新和消费者 PC 会话属于 FIX-16。

验证：

```powershell
pnpm --filter @lazy-armor/admin test
pnpm --filter @lazy-armor/admin build
node scripts/verify-admin-session-isolated.mjs --log artifacts/admin-session-fresh.log --browser 'C:/Program Files/Google/Chrome/Application/chrome.exe' --screenshot artifacts/admin-session-fresh.png
```

隔离验收脚本只使用已存在的测试 MySQL3311/Redis6391，新建唯一 test 库、运行迁移并注册测试账号，仅提升这些新 fixture 的角色。日志/截图路径必须全新；它们保留在私有 artifacts，不同步到 GitHub。CI 默认验证 API 权限与单元测试；实际 Next 子进程和浏览器需显式运行隔离验收。
