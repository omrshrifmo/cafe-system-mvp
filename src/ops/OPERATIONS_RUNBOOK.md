# Mazaj Cafe (كافيه مزاج) - Enterprise Operations & Disaster Recovery Runbook

**Version**: `v3.2-prod`  
**System Architecture**: Single-Node Embedded SQLite 3 + WAL Mode + Realtime WebSockets + ESC/POS Thermal Printing  
**Operating System**: Linux / POS Terminals  
**Last Updated**: 2026-08-25  

---

## 1. System Architecture & Recovery Objectives

| Metric | Target SLA | Measured Capability | Description |
| :--- | :--- | :--- | :--- |
| **RPO (Recovery Point Objective)** | $\le 15\text{ minutes}$ | $\approx 0\text{ seconds}$ (WAL live) / $15\text{ min}$ (Hot snapshot) | Maximum tolerable data loss in disaster. SQLite WAL mode syncs all transactions durably. |
| **RTO (Recovery Time Objective)** | $\le 60\text{ seconds}$ | $\approx 1.2 - 2.5\text{ seconds}$ | Time required to restore full operations from encrypted backup to isolated DB. |
| **Busy Timeout Threshold** | $5000\text{ ms}$ | $5000\text{ ms}$ | SQLite wait time before throwing `SQLITE_BUSY` on concurrent write lock. |
| **Uptime Claim Policy** | Fact-Grounded | Continuous soak / monitoring | One-year uptime is not claimed without long-term monitoring metrics. |

---

## 2. Standard Operational Scenarios & Runbooks

### Runbook A: Database Migration Failure & Safe Rollback

**Trigger**: A migration script fails during `npm start` or database startup, throwing `MIGRATION_FAILED`.

#### Recovery Steps:
1. **Identify the Failed Migration**:
   ```bash
   node -e '
     const { allQuery } = require("./src/db/connection");
     allQuery("SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 5").then(console.log);
   '
   ```
2. **Inspect Error & Stop Server**:
   Ensure no active traffic is writing to the database while investigating.
3. **Restore from Pre-Migration Hot Snapshot**:
   Backups are automatically taken prior to migration runs in `backups/`:
   ```bash
   cp backups/cafe-backup-LATEST.sqlite cafe.sqlite
   ```
4. **Verify Database Integrity**:
   ```bash
   sqlite3 cafe.sqlite "PRAGMA integrity_check;"
   sqlite3 cafe.sqlite "PRAGMA foreign_key_check;"
   ```
5. **Re-run Migrator with Fixed SQL**:
   ```bash
   npm run migrate
   ```

---

### Runbook B: Thermal Printer Offline / Out of Paper / Dead-Letter Recovery

**Trigger**: KDS or POS reports printer error `PRINTER_OFFLINE`, `PAPER_OUT`, or print job transitioned to `DEAD_LETTER`.

#### Diagnostic & Resolution Flow:
1. **Check Printer Health via API**:
   ```bash
   curl -X GET http://127.0.0.1:3000/api/health/readiness
   ```
2. **Inspect Dead-Letter Queue**:
   ```bash
   sqlite3 cafe.sqlite "SELECT id, job_type, attempts, error_message, created_at FROM print_jobs WHERE status = 'DEAD_LETTER' ORDER BY created_at DESC LIMIT 10;"
   ```
3. **Physical Hardware Resolution**:
   - Verify network cable or USB connection to thermal printer (`192.168.1.200:9100` / `127.0.0.1:9100`).
   - Replace thermal paper roll (80mm standard).
   - Ensure paper feed lever is locked.
4. **Replay / Retry Dead-Letter Jobs**:
   ```bash
   node -e '
     const { runQuery } = require("./src/db/connection");
     runQuery("UPDATE print_jobs SET status = '\''PENDING'\'', attempts = 0 WHERE status = '\''DEAD_LETTER'\''").then(console.log);
   '
   ```
5. **Safe Cash Drawer Verification**:
   - Cash drawer kicks are strictly restricted to `payment_method = 'CASH'`.
   - Never trigger hardware kick for digital / Visa settlements.

---

### Runbook C: Network Partition & Offline Sync Conflict Resolution

**Trigger**: Client terminals operate offline in local IndexedDB mode, then reconnect to sync outbox queue.

#### Conflict Resolution Policy:
1. **Idempotency Guard**:
   - Every offline command is tagged with a deterministic `idempotency_key` and payload SHA-256 hash.
   - Repeated sync submissions return `status: 'DUPLICATE'` without re-executing inventory or financial mutations.
2. **Optimistic Concurrency Control**:
   - Orders and sessions carry a `version` integer.
   - If server version exceeds client version, server returns `CONFLICT (409)`.
   - Client prompts cashier: `⚡ Resolve Conflict & Reload`.
3. **Settlement Safety Guard**:
   - Offline batch sync strictly rejects unverified financial settlements. Cash settlements must be submitted with valid shift session token.

---

### Runbook D: SQLite `SQLITE_BUSY` Lock Contention & Checkpoint Recovery

**Trigger**: Heavy concurrent reporting queries cause write delays or `SQLITE_BUSY: database is locked`.

#### Mitigation Architecture:
1. **Configured Busy Timeout**:
   - `PRAGMA busy_timeout = 5000;` ensures SQLite automatically retries writes for up to 5 seconds before erroring.
2. **WAL Checkpointing**:
   - Run manual passive checkpoint if WAL file exceeds 50MB:
   ```bash
   sqlite3 cafe.sqlite "PRAGMA wal_checkpoint(PASSIVE);"
   ```
3. **Dedicated Read Queries**:
   - Heavy BI and export queries utilize read-only transactions to prevent holding exclusive write locks.

---

## 3. Observability, Monitoring & Probes

### Health Probes
- **Liveness Probe**: `GET /api/health/liveness` $\rightarrow$ Checks process alive & memory bounds.
- **Readiness Probe**: `GET /api/health/readiness` $\rightarrow$ Checks:
  - Database PRAGMA `integrity_check`
  - Migration alignment (`applied_count == total_migrations`)
  - Outbox queue lag ($< 50$ pending)
  - Realtime WebSocket server state (`READY`)
  - Backup freshness age ($< 24\text{ hours}$)

### Resource Monitoring Thresholds
- **Memory RSS Alert**: $> 512\text{ MB}$ triggers warning alert.
- **Disk Free Space Alert**: $< 1\text{ GB}$ triggers urgent backup archive alert.
- **File Descriptors (FD)**: $< 100$ available triggers FD leak warning.

---

## 4. Disaster Recovery & Encrypted Backup Runbook

### Automatic Daily Backup Cycle:
1. Hot non-blocking snapshot via `VACUUM INTO`.
2. AES-256-GCM encryption with PBKDF2 salt derivation.
3. SHA-256 checksum verification and manifest persistence.
4. Retention policy: 30 daily snapshots, older snapshots pruned automatically.

### Manual On-Demand Encrypted Backup:
```bash
node -e '
  const { createEncryptedBackup } = require("./src/domain/system/backupService");
  createEncryptedBackup().then(console.log).catch(console.error);
'
```

### Full Restore Rehearsal Test:
```bash
node -e '
  const { testFullDisasterRecoveryRehearsal } = require("./src/domain/system/backupService");
  testFullDisasterRecoveryRehearsal().then(console.log).catch(console.error);
'
```
