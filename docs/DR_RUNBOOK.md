# Enterprise Disaster Recovery (DR) & Incident Runbooks

**System**: Mazaj Cafe ERP & POS Operating System  
**Architecture**: Server-Authoritative Node.js + SQLite WAL with Client IndexedDB Outbox  
**Recovery Targets**:
- **Recovery Point Objective (RPO)**: **< 1 Minute** (WAL real-time transaction journaling + Outbox queue).
- **Recovery Time Objective (RTO)**: **< 2 Minutes** (Automated process supervisor restart / Hot backup restore).

---

## Runbook 1: Server Process Crash / Node Reboot

### Symptoms
- Frontend displays `📡 وضع غير متصل (Offline)` or `⚠️ حدث خطأ في النظام`.
- HTTP health probe fails (`/api/health/liveness` returns connection refused).

### Step-by-Step Resolution
1. **Verify Process State**:
   ```bash
   ps aux | grep node
   ```
2. **Review Incident Error Logs**:
   ```bash
   tail -n 100 server.log
   ```
3. **Restart Process via Supervisor (PM2 or Systemd)**:
   ```bash
   npm start
   ```
4. **Verify System Readiness**:
   ```bash
   curl -s http://localhost:3000/api/health/readiness | jq .
   ```
5. **Confirm Client Outbox Replay**:
   - Web terminals automatically reconnect via WebSocket.
   - Pending local IndexedDB commands synchronize automatically without duplicate submissions.

---

## Runbook 2: Database File Corruption or Storage Failure

### Symptoms
- `/api/health/readiness` reports `FAIL` on `database_integrity`.
- Error logs report `SQLITE_CORRUPT` or `SQLITE_IOERR`.

### Step-by-Step Resolution
1. **Halt Application Process**:
   ```bash
   kill -TERM $(pgrep -f "node src/server.js")
   ```
2. **Locate Latest Verified Hot Backup**:
   ```bash
   ls -la backups/
   ```
3. **Verify Backup Checksum against Manifest**:
   ```bash
   sha256sum backups/cafe-backup-*.sqlite
   ```
4. **Quarantine Corrupted Database**:
   ```bash
   mv cafe.db cafe.db.corrupt-$(date +%s)
   ```
5. **Restore Verified Snapshot**:
   ```bash
   cp backups/cafe-backup-<LATEST>.sqlite cafe.db
   ```
6. **Start Application & Verify DB Integrity**:
   ```bash
   npm start
   curl -s http://localhost:3000/api/health/readiness | jq .checks.database_integrity
   ```

---

## Runbook 3: Thermal Receipt Printer Disconnection / Paper Jam

### Symptoms
- KDS and POS bill checkout completes, but thermal receipt fails to feed/cut.
- Error logs or UI reports `PRINTER_OFFLINE` or `PRINTER_BUFFER_TIMEOUT`.

### Step-by-Step Resolution
1. **Check Physical Hardware**:
   - Check paper roll presence and feed cover closure.
   - Verify network cable or USB connection to thermal printer IP (`192.168.1.100`).
2. **Inspect Print Queue Worker**:
   - Print jobs are queued in SQLite outbox table `outbox_events` / `print_jobs`.
   - The print worker will retry up to 5 times with exponential backoff.
3. **Manual Reprint from UI**:
   - Open Order History or POS Ticket.
   - Click `📜 شيك` or `🖨️ طباعة الإيصال`.
   - POS sends reprint command using the stored receipt snapshot without altering ledger financial totals.

---

## Runbook 4: LAN / Internet Disconnection & Offline Reconciliation

### Symptoms
- Network badge turns red: `وضع غير متصل (Offline)`.
- Internet gateway is unreachable.

### Operational Staff Protocol
1. **Continue Point of Sale**:
   - POS switches to offline IndexedDB outbox.
   - Cashiers continue creating orders and drafting tickets.
   - Orders receive client idempotency keys (`CLI_...`).
2. **Network Reconnection**:
   - Once LAN/Internet is restored, the browser `online` listener fires `syncPendingOfflineCommands()`.
   - Server processes batch with `IDEMPOTENT_APPLY`.
   - Receipts are issued and table states update in real time.

---

## Runbook 5: Factory Reset Protocol (Live Mode Guard)

### Safety Rules
- Factory Reset in **LIVE MODE** is strictly forbidden without:
  1. `SUPER_ADMIN` or `OWNER` role authentication.
  2. Verified recent online backup created within the last 10 minutes.
  3. Explicit typed confirmation text: `RESET_MAZAJ_PRODUCTION_DATA`.
4. All reset events are written to the append-only security audit log before execution.
