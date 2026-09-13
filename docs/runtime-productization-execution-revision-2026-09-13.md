# 2026-09-13 执行修订：Secret 验收边界

用户明确授权继续 Batch 9B 的全部非 Secret 实现。缺少 Google OAuth Secret 只阻塞真实账号授权与 Provider Journey 验收，不阻塞配置契约、后端 HTTPS callback、PKCE、token/refresh/revoke、Gmail ProviderAdapter、5 项 Capability、Observation→Candidate→Truth、现有动作主链适配及隔离测试。

配置键固定为 GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET / GMAIL_OAUTH_REDIRECT_URI。未配置时必须禁用真实 Provider，不允许模拟 fallback。真实账号验收未通过不得关闭 9B 或声明真实 Gmail 完成。

后续依次复用同一认证基础推进 Calendar→GitHub→Notion→跨 Provider，再进入 Batch 10 场景现实化与 8 Strategy Goldens、Batch 11 数据驱动 Mobile、Batch 12 扩张、Batch 13 真机 Staging、Batch 14 全量 RC。不得重写 Execution、Strategy、Risk/Approval、Verification/Reconciliation；普通工程失败定位修复继续，Hard Stop 仅暂停相关链路。
