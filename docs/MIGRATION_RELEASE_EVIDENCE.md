# Destructive Migration Release Evidence

当任一新增数据库迁移包含 `DROP TABLE`、`TRUNCATE`、`DELETE FROM`、`RENAME TABLE`，或 `ALTER TABLE` 的 `DROP`、`MODIFY`、`CHANGE` 操作时，`pnpm migration:safety` 会失败关闭。该规则不允许以“迁移已在本地通过”为由绕过备份恢复与审批证据。

> **安全原则：** 证据文件只能描述环境、数据库目标、提交、备份恢复结果和迁移内容哈希；不得包含连接密码、访问令牌、真实用户数据或备份正文。

## 证据文件

将以下 JSON 放在受控的 CI 临时工作目录或受保护的 release evidence 存储中。该文件不应提交到仓库。

```json
{
  "environment": "staging",
  "database": "mysql://release-user@staging-db.internal:3306/lazy_armor_staging",
  "commitSha": "<git rev-parse HEAD>",
  "backupRestoreGate": {
    "status": "passed",
    "artifact": "https://ci.example.invalid/artifacts/backup-restore/run-123",
    "completedAt": "2026-09-04T12:00:00.000Z"
  },
  "approvedMigrations": [
    {
      "file": "0029_example.sql",
      "sha256": "<sha256sum packages/database/drizzle/0029_example.sql>"
    }
  ]
}
```

| 字段 | 门槛 |
|---|---|
| `environment` | 只能是 `staging` 或 `production`。 |
| `database` | 必须标识非本地数据库目标；不应携带密码。 |
| `commitSha` | 必须与运行检查时的 `HEAD` 完全一致。 |
| `backupRestoreGate` | `status` 必须为 `passed`，且必须同时包含 artifact 定位信息与完成时间。 |
| `approvedMigrations` | 每个高风险迁移都必须以文件名和精确 SHA-256 哈希批准。 |

## 执行方式

```bash
MIGRATION_SAFETY_EVIDENCE_PATH=/secure/path/migration-release-evidence.json \
  pnpm migration:safety
```

通过该门槛不等于允许直接部署。部署系统仍应先取得变更审批、验证备份恢复 artifact 可访问，并在目标环境使用最小权限账户应用迁移。
