# P4 Development Report

状态：IN PROGRESS

P3 阶段全回归通过后已直接进入 P4。当前工作聚焦现有五个一级 Tab（今天 / 计划 / ＋ / 记录 / 我的）的消费者产品化、模板库分类、计划详情解释、Today 行动过滤与 Beta 验收证据，不新增领域一级 Tab。

P4 聚焦普通用户可独立使用与 Beta，不扩张一级导航；永久保持“今天、计划、＋、记录、我的”。

当前 P4 第一优先级已切到 P0-H4 / P0-H3 / Environment Gate 硬化。Worker 侧已经补齐 execution-worker 与 outbox-worker 的 true-process focused reliability evidence：真实 `execution-worker.main` / `outbox-worker.main`、真实 MySQL / Redis / BullMQ / Worker Probe、Redis/MySQL 临时中断恢复、SIGTERM/SIGINT、有界 `/ready`、lease recovery、pending outbox recovery、runtime permission revoke、timeout/outcome_unknown，以及 provider success 后 worker crash 的 exactly-once 恢复路径。
