# Batch 9B — Gmail 真实接入预检

日期：2026-09-13。状态：Hard Stop — 缺少真实 Google OAuth Secret；不是 Gmail 接入完成报告。

执行修订：用户在 2026-09-13 明确此缺口只阻塞真实授权验收，不阻塞非 Secret 开发。下列为原始预检历史，不再作为停止整个开发的依据。后续实现与隔离回归进度见 [9B 开发报告](./runtime-productization-batch-9b-report.md)。

## 前置结果

Batch 6～8 在 main@311f472 的远端完整 CI #63 全部成功，包含 Android。Batch 9A 公共层实现和本地完整门禁已完成，随后立即进行本批预检，没有在公共层完成前以 Secret 为理由停止。

## 实际检查

- ConfigModule 加载 ../../.env 和 .env。仓库根 .env 存在，apps/api/.env 不存在。
- 仅解析上述文件的配置变量名称，以及 Process / User / Machine 环境变量名称。Google / Gmail / OAuth 匹配计数均为 0；未输出变量值，未扫描个人凭据库。
- config parser 和环境示例未登记真实 Google OAuth 配置；既有 GmailConnector 不能作为真实账号集成证据，首批 Gmail Manifest 仍保留待核实的官方能力骨架。
- 既有 CredentialsModule 明确拒绝生产环境回退到 LocalEncryptedCredentialProvider，且尚未注册托管 production Credential Provider。该安全边界保持不变，不能用本地加密文件冒充生产 Secret 后端。
- GitHub 连接工具不支持 secrets API，未尝试读取远端 Secret 或把未知配置宣称可用。

## Hard Stop 与恢复条件

缺少真实 OAuth Client Secret 符合最高规划 Hard Stop。需要用户通过安全配置渠道提供 Google OAuth Client ID / Client Secret，并确认已登记 Redirect URI、OAuth 项目和可用于授权测试的账号。请勿把 Secret 直接粘贴到聊天或提交 Git。

生产验收前还必须接入受支持的托管 Credential Provider，并保持生产配置缺失时拒绝启动；本报告不把这项尚未实现的依赖隐瞒为已通过。

本次没有使用真实账号发送邮件、发布内容、创建订单或支付；没有新增模拟生产 fallback。Batch 9B 尚无真实 Token / Scope / Gmail API / SourceObservation / Truth / 发送验证 Journey 验收；9C～9F、10～14 未越过前置依赖执行。解除 Secret 缺口后继续固定顺序，不需要再次确认每个小阶段。
