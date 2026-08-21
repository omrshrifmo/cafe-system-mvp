# Database Backup, Disaster Recovery & Restore Procedures

## 1. Hot Online Backups (Zero-Locking `VACUUM INTO`)

The Mazaj platform uses SQLite's native `VACUUM INTO` command to create consistent, transactionally-safe online snapshots of the active database while POS terminals and KDS screens remain in full active operation without read/write locks.

### 1.1 Running Backup via CLI
```bash
node src/db/cli.js backup
```

### 1.2 Automated Output
Backups are saved to the `backups/` directory with UTC timestamped naming:
```
backups/backup_cafe_2026-08-22T01-30-00-000Z.db
```

---

## 2. Point-in-Time Recovery & Restore Workflow

### 2.1 Full Restore from Backup
To restore a snapshot into the active database:
```bash
node src/db/cli.js restore backups/backup_cafe_2026-08-22T01-30-00-000Z.db
```

### 2.2 Safety Guard
The restore command automatically creates a temporary safety snapshot (`cafe_pre_restore_safety_*.db`) before overwriting the active database, preventing irreversible data loss.

---

## 3. Scheduled Automated Backups (Cron / Systemd)

Add the following cron entry to the host system to run automated hourly snapshots with 7-day retention:

```bash
# Run hourly backup at minute 0
0 * * * * cd /home/omrshrifmo/cafe-system-mvp && node src/db/cli.js backup >> logs/backup.log 2>&1

# Prune backups older than 7 days daily at 03:00 AM
0 3 * * * find /home/omrshrifmo/cafe-system-mvp/backups/ -name "backup_*.db" -mtime +7 -delete
```
