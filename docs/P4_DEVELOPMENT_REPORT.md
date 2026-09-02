# P4 Development Report

状态：IN PROGRESS

P3 阶段全回归通过后已直接进入 P4。当前工作聚焦现有五个一级 Tab（今天 / 计划 / ＋ / 记录 / 我的）的消费者产品化、模板库分类、计划详情解释、Today 行动过滤与 Beta 验收证据，不新增领域一级 Tab。

P4 聚焦普通用户可独立使用与 Beta，不扩张一级导航；永久保持“今天、计划、＋、记录、我的”。

当前 P4 第一优先级已切到 P0-H4 / P0-H3 / Environment Gate 硬化。Worker 侧已经补齐 execution-worker 与 outbox-worker 的 true-process focused reliability evidence：真实 `execution-worker.main` / `outbox-worker.main`、真实 MySQL / Redis / BullMQ / Worker Probe、Redis/MySQL 临时中断恢复、SIGTERM/SIGINT、有界 `/ready`、lease recovery、pending outbox recovery、runtime permission revoke、timeout/outcome_unknown，以及 provider success 后 worker crash 的 exactly-once 恢复路径。

P0-H4 已达到 `CODE COMPLETE / READY FOR WAVE 0 ACCEPTANCE`：Operations 现可保留 503 readiness 的真实依赖状态与 reason，所有数据库诊断均显式区分 available / unavailable，UNKNOWN 不再伪装为 0；独立 Operations true-process linkage 覆盖两类 Worker 的 DOWN → UP → Redis DEGRADED → UP → MySQL DEGRADED → UP → Kill DOWN → Restart UP。

H4 Final Focused Gate：API build、Harness 3/3、execution-worker 8/8、outbox-worker 13/13、Operations linkage 1/1、API typecheck 全部 PASS。H4 故障套件固定串行运行。

P0-H3 已达到 `CODE COMPLETE / READY FOR WAVE 0 ACCEPTANCE`：Webhook 强制签名与时间戳；最终矩阵覆盖 bad signature、wrong secret、缺失字段、过期时间戳、超过 100KB、并发重复、最小化 DB 存储、retention 身份保留、敏感值缺失及 cleanup Audit。H3 Gate：matrix 1/1、P0 Final Security 12/12、P0 主集成 8/8、API build/typecheck 全部 PASS。

Environment Isolation Code Gate 已完成：staging/production 配置 fail-closed，Redis/BullMQ 采用环境专属命名空间，移动端阻断 localhost/HTTP API，独立无 secret 配置模板已建立。Config 10/10、Mobile Env 8/8、P0 Final Security 12/12 与相关 typecheck PASS。真实 staging runtime 因尚无托管 Credential Provider 保持 fail-closed，待外部基础设施补证。

P4 状态仍为 IN PROGRESS；当前主线为 Android Beta，随后进入 Observability 与 Backup/Restore。
