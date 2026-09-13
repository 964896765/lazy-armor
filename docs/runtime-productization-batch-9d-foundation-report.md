# Batch 9D — 配置与原始字节验签预备子步骤

日期：2026-09-13；基线 main@02e77bd74d51024444450aa56bceba4417066245。**这是 GitHub 接入开始的子步骤，不是 9D 完成报告；Adapter/5 Capability/Service/API/Generic Truth/Execution Journey 尚未实现，不关闭 9D。**

已实现独立 GitHub OAuth 配置解析、缺失/部分/占位/HTTPS/精确回调校验，以及可缺失的强 Webhook Secret 配置。配置 parseEnv fail-closed，不向外发请求，不增加 GitHub fixture，不注册未实现 Capability。已实现原始 Buffer 的 HMAC SHA-256 常量时间验签与 payloadHash；缺 Secret/缺签名/坏格式/正文被改/JSON re-stringify/空或超大正文均拒绝。替换未签名 delivery header 不改变 payloadHash，不能借该 header 绕过去重。

Schema/Type：扩展现有 AppEnv，新增 GitHubOAuthConfig 与验签 input/output 类型。DDL Migration N/A：本步骤是配置和纯验证函数，不增加表/列，不改变既有 47 个 migration。后续完整 9D 使用已有 OAuth/Credentials/Generic Registry；实际必要新列另走 additive migration。

专项：Config **4 文件/51 项通过**（17:50:10，697ms），其中 GitHub 新增 15 项，已有 36 项未回退；raw-byte signature **1 文件/12 项通过**（17:50:12，420ms）。验签测试不替代 repository/connection 权限、安全 ingress 或 Webhook DB 并发测试。

同一源码 build **8/8**（22.247s）、typecheck **8/8**（16.033s）；Full API **81 文件 passed、1 skipped，523 passed、4 skipped / 527**（17:53:06，480.74s）；Monorepo **16/16**（8m23.694s，API 非 cache 实际执行，其他未变模块复用 12 项 cache）。Migration safety **47 files/destructive=0**、data-truth、dependency audit（无已知漏洞）、repository hygiene **642 tracked files**、cached diff whitespace 通过。现阶段没有实际 Provider Service/API，故没有该 Provider 的 API/DB Journey Contract；完整 9D 必须补齐再报告完成。当前并行的 Calendar [CI #66](https://github.com/964896765/lazy-armor/actions/runs/34750300128) 属于 02e77bd 的独立证据，不能拿来给本子步骤或 GitHub 实际接入标 FULL GREEN。本子步骤自己的远端证据须在推送后独立核验。

日志：`.data/batch-9d-foundation-config.log`、`.data/batch-9d-foundation-signature.log`、`.data/batch-9d-foundation-build.log`、`.data/batch-9d-foundation-typecheck.log`、`.data/batch-9d-foundation-monorepo.log`。既有 skipped 不算已执行；没有真实 GitHub Token/OAuth/Webhook Journey 验收。

下一实现步骤：GitHub 专属固定 origin 的 transport/OAuth S256、实际 Scope/账号/repository 权限 → 5 Capability Adapter → Generic Observation/Candidate/Truth 与 signed Webhook → 既有动作/审批/Verification/Reconciliation → PR SILENT_FOLLOW_UP 与批准 Issue/Comment TCP/DB 并发 Journey。缺真实 Secret 仅阻塞实际账号验收。
