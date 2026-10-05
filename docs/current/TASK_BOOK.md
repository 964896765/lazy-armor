# 当前任务书 — V8.3

按 V8.3-0 → A RuntimeTarget → B Canonical Capability → C Invocation → D Runtime Projection → E Result Ledger/ACK/Resume → F/G Android/Provider/MCP/Windows → H Cloud Workspace → I Capability Synthesis → J Persistent Replanning → K Golden Flow 连续推进。

仅补现有权威链协议层，不新建 Plan/Truth/Execution/ToolTaskRegistry。保留所有现有未提交实现和真实Evidence，migration append-only。真实Credential、不可逆副作用、OS人工权限、破坏性迁移或不明确的authority/fencing需要Hard Stop；其余阻塞fail closed并继续独立工作。

每个Checkpoint运行全仓typecheck、受影响package完整测试及专项测试。Schema变化验证MySQL8.4、owner isolation、并发、幂等和迁移安全。合流前运行hygiene、terminology、data truth、migration safety、全仓真实DB测试、build、db:rc-integration和Android verification。

完整CI现已提供pull_request及workflow_dispatch；保留MySQL8.4、backup/restore、real DB和Android gate。本地通过不能写成GitHub Green。真实验收和自动测试分别记账。
