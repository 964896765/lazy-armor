# V8.1 产品入口与开发登录进展

本记录区分代码及隔离测试通过、真机验证、尚未验收。现有执行 Authority 与引擎保持复用。

## 开发验证码

- `/auth/code/send`（兼容 `/auth/code/request`）生成随机六位一次性码；Redis 保存 HMAC，300 秒过期，账号/IP 发送与验证限流，原子消费防重放。
- Local Provider 仅在 NODE_ENV=development 且 APP_ENV 未指定或为 development、当前渠道未配置 endpoint 时可用。预发布/生产和已配置但失败的真实网关均不得回退。
- 仅本地后端控制台输出渠道、脱敏账号、验证码、过期时间；响应、Audit、前端和 Git 不包含真实验证码。控制台日志位于工作区外的本机 Temp。
- 正式 verify 后已有身份复用账号；首次身份验证创建账号、资料、免费会员与验证身份。手机/邮箱使用同一登录页。
- 真机邮箱登录已由 LOGIN_CODE_VERIFIED Audit 确认。刷新等待从 3 秒延长为 12 秒后，最新真机登录成功；强制重启后令牌正常轮换，持续导航超过原失效窗口，数据库新 Session 未撤销。保留后端 refresh reuse 检测。

## 最新产品整改

- 资源本机 Tab 直接展示原生读取列表，移除消息获取/消息通知/后台服务的重复设置与嵌套管理入口。
- 会话左上菜单打开左侧会话记录栏，按当前临时/计划模式过滤真实记录。
- 服务工作台：我的服务、收到的请求、我的发布；底部普通服务设置菜单。外部引用只通过首页外部 Tab 进入。
- ServiceRequest 增加服务端 consumer/provider 视图筛选和明确关系投影。保留现有版本检查、提供方状态流转、消费者取消与日程汇总。
- 我的发布直接查询当前账号拥有的全部 Offering，展示已发布/草稿/已下架；新增拥有者编辑、下架、重新发布、完整资料草稿保存。更新检查 updatedAt 并写入 Audit，越权拒绝，已有请求不受下架删除影响。
- 服务设置展示真实服务方资料及各 Offering 地区/联系方式；通知使用现有应用权限。未新增不存在的认证或服务通知偏好 Authority。

## 验证与范围

- API 验证码与消费者集成测试 26 项通过，包含提供方/消费者区分、越权编辑拒绝、过期修改拒绝、下架目录隐藏、草稿保存、履约进入日程。
- 移动端 API/会话认证测试 19 项通过；移动端类型检查与 API build 通过。
- 集成测试使用隔离测试数据，不能作为真实服务履约或六条 Golden Flow 真机证据。
- 真机资源页直接显示日历/通讯录/应用使用情况/位置，无三项重复通知设置；会话侧栏加载当前模式真实历史；服务工作台显示三个卡片与低频设置。收到的请求真实为空，未伪造订单验收。截图/XML 位于 `artifacts/android/v8-productization` 的 `v81-resources-inline-final`、`v81-conversation-sidebar`、`v81-login-submit-result`、`v81-incoming-requests`。
- V8.1 Source Resolver、Acquisition、20 Contracts、Assessment、WorkItem 的已有增量尚未完成全部真实来源接入与六条 Golden Flow 验收，不宣称整体完成。
- 最终 Android APK 已覆盖安装，SHA256 `A5EF7439EF8A0BFCFB22B69E26164C79C405DFA99F651A2A1C828B3088889F89`。侧栏顶部关闭按钮真机可见，记录 `v81-sidebar-final`。开发 API 已使用最新构建重启，health=ok。
