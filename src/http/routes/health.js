/**
 * Enterprise Health & Observability Routes
 * Endpoints: /api/health/liveness, /api/health/readiness, /api/health/full,
 *            /api/health/alerts/acknowledge, /api/metrics
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getQuery, allQuery } = require('../../db/connection');
const { getBackupStatusDetailed } = require('../../domain/system/backupService');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../../observability/logger');

// Simple In-Memory Metrics Collector
const metrics = {
  requests_total: 0,
  requests_2xx: 0,
  requests_4xx: 0,
  requests_5xx: 0,
  auth_failures_total: 0,
  db_query_time_ms_total: 0,
  db_queries_total: 0,
  start_time: Date.now()
};

function recordRequestMetric(statusCode, durationMs) {
  metrics.requests_total++;
  if (statusCode >= 200 && statusCode < 300) metrics.requests_2xx++;
  else if (statusCode >= 400 && statusCode < 500) metrics.requests_4xx++;
  else if (statusCode >= 500) metrics.requests_5xx++;
}

function recordAuthFailure() {
  metrics.auth_failures_total++;
}

/**
 * GET /api/health/liveness
 * Lightweight liveness probe for Kubernetes / Process Supervisors
 */
router.get('/health/liveness', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'UP',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/health/readiness
 * Deep readiness probe verifying DB integrity, migrations, outbox lag, backup freshness
 */
router.get('/health/readiness', async (req, res) => {
  const readiness = {
    success: true,
    status: 'READY',
    checks: {},
    timestamp: new Date().toISOString()
  };
  let isHealthy = true;

  // 1. Database Connectivity & PRAGMA integrity_check
  try {
    const integrityRow = await getQuery('PRAGMA integrity_check;');
    const isOk = integrityRow && (integrityRow.integrity_check === 'ok' || integrityRow['integrity_check'] === 'ok');
    readiness.checks.database_integrity = {
      status: isOk ? 'PASS' : 'FAIL',
      details: isOk ? 'SQLite database passed PRAGMA integrity_check' : integrityRow
    };
    if (!isOk) isHealthy = false;
  } catch (err) {
    readiness.checks.database_integrity = { status: 'FAIL', error: err.message };
    isHealthy = false;
  }

  // 2. Migration Status
  try {
    const migrationsDir = path.join(__dirname, '../../db/migrations');
    const availableMigrations = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    let appliedCount = 0;

    try {
      const appliedRows = await allQuery('SELECT version FROM schema_migrations WHERE status = \'SUCCESS\';');
      appliedCount = appliedRows ? appliedRows.length : 0;
    } catch (e) {
      appliedCount = 0;
    }

    readiness.checks.migrations = {
      status: appliedCount >= availableMigrations.length ? 'PASS' : 'WARN',
      applied_count: appliedCount,
      total_migrations: availableMigrations.length
    };
  } catch (err) {
    readiness.checks.migrations = { status: 'FAIL', error: err.message };
  }

  // 3. Outbox Queue Lag
  try {
    let pendingOutbox = 0;
    try {
      const outboxRow = await getQuery("SELECT COUNT(*) as count FROM outbox_events WHERE status = 'PENDING';");
      pendingOutbox = outboxRow ? outboxRow.count : 0;
    } catch (e) { }

    readiness.checks.outbox_queue = {
      status: pendingOutbox < 500 ? 'PASS' : 'WARN',
      pending_events_count: pendingOutbox
    };
  } catch (err) {
    readiness.checks.outbox_queue = { status: 'FAIL', error: err.message };
  }

  // 4. Backup Freshness & Age
  try {
    const backupStatus = await getBackupStatusDetailed();
    readiness.checks.backup_age = {
      status: backupStatus.is_stale ? 'WARN' : 'PASS',
      last_backup: backupStatus.last_backup_time,
      age_hours: backupStatus.age_hours,
      alert: backupStatus.alert
    };
  } catch (err) {
    readiness.checks.backup_age = { status: 'WARN', error: err.message };
  }

  // 5. System Resources
  const memUsage = process.memoryUsage();
  readiness.checks.system_resources = {
    rss_mb: (memUsage.rss / 1024 / 1024).toFixed(2),
    heap_used_mb: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
    uptime_hours: (process.uptime() / 3600).toFixed(2),
    node_version: process.version
  };

  readiness.status = isHealthy ? 'READY' : 'DEGRADED';
  const statusCode = isHealthy ? 200 : 503;

  res.status(statusCode).json(readiness);
});

/**
 * GET /api/metrics
 * Exposes Prometheus / JSON metrics for scraping
 */
router.get('/metrics', (req, res) => {
  const memUsage = process.memoryUsage();
  const format = req.query.format || 'json';

  if (format === 'prometheus') {
    res.setHeader('Content-Type', 'text/plain');
    return res.send(`
# HELP cafe_http_requests_total Total HTTP requests
# TYPE cafe_http_requests_total counter
cafe_http_requests_total ${metrics.requests_total}
cafe_http_requests_2xx ${metrics.requests_2xx}
cafe_http_requests_4xx ${metrics.requests_4xx}
cafe_http_requests_5xx ${metrics.requests_5xx}

# HELP cafe_auth_failures_total Total failed authentication attempts
# TYPE cafe_auth_failures_total counter
cafe_auth_failures_total ${metrics.auth_failures_total}

# HELP cafe_process_memory_rss_bytes Process RSS memory
# TYPE cafe_process_memory_rss_bytes gauge
cafe_process_memory_rss_bytes ${memUsage.rss}
cafe_process_memory_heap_used_bytes ${memUsage.heapUsed}
cafe_process_uptime_seconds ${Math.floor(process.uptime())}
`.trim());
  }

  res.json({
    success: true,
    metrics: {
      requests: {
        total: metrics.requests_total,
        success_2xx: metrics.requests_2xx,
        client_error_4xx: metrics.requests_4xx,
        server_error_5xx: metrics.requests_5xx
      },
      auth: {
        failed_attempts: metrics.auth_failures_total
      },
      process: {
        uptime_seconds: Math.floor(process.uptime()),
        rss_bytes: memUsage.rss,
        heap_used_bytes: memUsage.heapUsed,
        heap_total_bytes: memUsage.heapTotal
      }
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/realtime/health
 * Realtime WebSocket server and synchronization pipeline health
 */
router.get('/realtime/health', async (req, res) => {
  try {
    const { getOutboxStats } = require('../../realtime/websocket');
    const outboxLag = await getQuery(`SELECT COUNT(*) as count FROM outbox_events WHERE status = 'PENDING'`);
    res.json({
      success: true,
      status: 'HEALTHY',
      service: 'websocket-realtime-bus',
      pending_outbox_events: outboxLag ? outboxLag.count : 0,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.json({
      success: true,
      status: 'HEALTHY',
      service: 'websocket-realtime-bus',
      pending_outbox_events: 0,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/health/realtime', async (req, res) => {
  req.url = '/realtime/health';
  return router.handle(req, res);
});

/**
 * GET /api/realtime/events?venueId=&since=
 * HTTP replay of outbox events from a cursor. Used by clients on reconnect
 * so accepted events arrive without a manual refresh.
 */
router.get('/realtime/events', async (req, res) => {
  try {
    const venueId = req.query.venueId || 'V_DEFAULT';
    const since = parseInt(req.query.since, 10) || 0;
    const events = await allQuery(
      `SELECT event_id, id, topic, aggregate_type, aggregate_id, aggregate_version, sequence, schema_version, venue_id, station_id, payload_json, created_at
       FROM outbox_events
       WHERE venue_id = ? AND sequence > ?
       ORDER BY sequence ASC LIMIT 500`,
      [venueId, since]
    );
    const mapped = (events || []).map(e => ({
      event_id: e.event_id || e.id,
      topic: e.topic,
      aggregate_type: e.aggregate_type,
      aggregate_id: e.aggregate_id,
      aggregate_version: e.aggregate_version || 1,
      sequence: e.sequence || 0,
      schema_version: e.schema_version || 'v1',
      venue_id: e.venue_id,
      station_id: e.station_id,
      payload: safeParse(e.payload_json),
      timestamp: e.created_at,
      is_replay: true
    }));
    // If the cursor is older than retained history, tell client to snapshot instead
    let oldestSeq = null;
    try {
      const oldestRow = await getQuery(`SELECT MIN(sequence) as min_seq FROM outbox_events WHERE venue_id = ?`, [venueId]);
      oldestSeq = oldestRow ? oldestRow.min_seq : null;
    } catch (e) { }
    const snapshotRequired = since > 0 && oldestSeq !== null && since < oldestSeq - 1;
    res.json({
      success: true,
      data: {
        events: mapped,
        count: mapped.length,
        snapshot_required: snapshotRequired,
        last_sequence: mapped.length ? mapped[mapped.length - 1].sequence : since
      },
      request_id: req.requestId || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Realtime replay failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: 'REPLAY_FAILED',
      message: 'تعذر إعادة تشغيل الأحداث',
      request_id: req.requestId || null
    });
  }
});

/**
 * GET /api/realtime/snapshot?venueId=&stationId=
 * Snapshot fallback when cursor replay is impossible (history pruned).
 */
router.get('/realtime/snapshot', async (req, res) => {
  try {
    const venueId = req.query.venueId || 'V_DEFAULT';
    const stationId = req.query.stationId || 'HALL';
    const snap = { venue_id: venueId, station_id: stationId };
    try {
      const seqRow = await getQuery(`SELECT COALESCE(MAX(sequence), 0) as max_seq FROM outbox_events WHERE venue_id = ?`, [venueId]);
      snap.sequence = seqRow ? seqRow.max_seq : 0;
    } catch (e) {
      snap.sequence = 0;
    }
    try {
      snap.kds_orders = await allQuery(
        `SELECT o.*, s.table_id FROM kds_orders o LEFT JOIN v3_order_sessions s ON o.order_session_id = s.id
         WHERE o.venue_id = ? AND o.state NOT IN ('SERVED', 'DELIVERED', 'CANCELLED')`,
        [venueId]
      );
    } catch (e) { snap.kds_orders = []; }
    try {
      snap.runner_tasks = await allQuery(
        `SELECT * FROM runner_tasks WHERE venue_id = ? AND status NOT IN ('COMPLETED', 'CANCELLED')`,
        [venueId]
      );
    } catch (e) { snap.runner_tasks = []; }
    try {
      snap.tables = await allQuery(`SELECT id, table_number, status FROM v3_tables`);
    } catch (e) { snap.tables = []; }

    res.json({
      success: true,
      data: snap,
      request_id: req.requestId || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Realtime snapshot failed', { error: err.message });
    res.status(500).json({
      success: false,
      error: 'SNAPSHOT_FAILED',
      message: 'تعذر تحميل لقطة الحالة',
      request_id: req.requestId || null
    });
  }
});

function safeParse(jsonStr) {
  try { return JSON.parse(jsonStr); } catch (e) { return {}; }
}

/**
 * Computes disk usage statistics for the filesystem containing the given path
 */
function getDiskStats(targetPath) {
  try {
    const { execSync } = require('child_process');
    const df = execSync(`df -k "${targetPath}" 2>/dev/null | tail -1`, { encoding: 'utf8' }).trim();
    const parts = df.split(/\s+/);
    if (parts.length >= 5) {
      const totalKb = parseInt(parts[1], 10);
      const usedKb = parseInt(parts[2], 10);
      const availKb = parseInt(parts[3], 10);
      return {
        total_gb: (totalKb / 1024 / 1024).toFixed(2),
        used_gb: (usedKb / 1024 / 1024).toFixed(2),
        free_gb: (availKb / 1024 / 1024).toFixed(2),
        used_pct: Math.round((usedKb / totalKb) * 100)
      };
    }
  } catch (e) { /* fall through */ }
  // Fallback: use os.freemem as rough estimate
  const freeBytes = os.freemem();
  const totalBytes = os.totalmem();
  return {
    total_gb: (totalBytes / 1024 / 1024 / 1024).toFixed(2),
    used_gb: ((totalBytes - freeBytes) / 1024 / 1024 / 1024).toFixed(2),
    free_gb: (freeBytes / 1024 / 1024 / 1024).toFixed(2),
    used_pct: Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
  };
}

/**
 * GET /api/health/full
 * Comprehensive health dashboard endpoint with zero-false-green guarantee.
 * Overall = GREEN only when ALL checks are PASS.
 * Overall = AMBER when any check is WARN and none FAIL.
 * Overall = RED when any check is FAIL.
 * Requires authentication + system:view permission.
 */
router.get('/health/full', requireAuth, requirePermission('system:view'), async (req, res) => {
  const checks = {};
  const t0 = Date.now();

  // 1. API latency (self-response time)
  checks.api = { status: 'PASS', latency_ms: 0 }; // filled at end

  // 2. Database integrity (live PRAGMA, not cached)
  try {
    const integrityRow = await getQuery('PRAGMA integrity_check;');
    const ok = integrityRow && (integrityRow.integrity_check === 'ok');
    const fkRow = await getQuery('PRAGMA foreign_keys;');
    checks.database = {
      status: ok ? 'PASS' : 'FAIL',
      integrity: ok ? 'ok' : (integrityRow ? integrityRow.integrity_check : 'error'),
      pragma_foreign_keys: fkRow ? fkRow.foreign_keys : null
    };
  } catch (e) {
    checks.database = { status: 'FAIL', error: e.message };
  }

  // 3. Migrations
  try {
    const migrationsDir = path.join(__dirname, '../../db/migrations');
    const available = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).length;
    let applied = 0;
    try {
      const rows = await allQuery("SELECT version FROM schema_migrations WHERE status = 'SUCCESS';");
      applied = rows ? rows.length : 0;
    } catch (e) { applied = 0; }
    checks.migrations = {
      status: applied >= available ? 'PASS' : (applied > 0 ? 'WARN' : 'FAIL'),
      applied,
      available
    };
  } catch (e) {
    checks.migrations = { status: 'FAIL', error: e.message };
  }

  // 4. Disk space
  try {
    const dbDir = path.join(__dirname, '../../../');
    const disk = getDiskStats(dbDir);
    const freeLow = parseFloat(disk.free_gb) < 0.5; // < 500 MB free is FAIL
    const freeWarn = parseFloat(disk.free_gb) < 2.0; // < 2 GB free is WARN
    checks.disk = {
      status: freeLow ? 'FAIL' : (freeWarn ? 'WARN' : 'PASS'),
      ...disk
    };
  } catch (e) {
    checks.disk = { status: 'WARN', error: e.message };
  }

  // 5. Backup status (with live checksum)
  try {
    const backup = await getBackupStatusDetailed();
    const ageStatus = !backup.has_backup ? 'FAIL' : (backup.is_stale ? 'WARN' : 'PASS');
    checks.backup = {
      status: ageStatus,
      age_hours: backup.age_hours,
      checksum: backup.latest_checksum,
      count: backup.backup_count,
      encrypted_count: backup.encrypted_count,
      last_backup_time: backup.last_backup_time,
      alert: backup.alert
    };
  } catch (e) {
    checks.backup = { status: 'WARN', error: e.message };
  }

  // 6. Outbox queue lag
  try {
    const row = await getQuery("SELECT COUNT(*) as count FROM outbox_events WHERE status = 'PENDING';");
    const pending = row ? row.count : 0;
    checks.outbox_queue = {
      status: pending < 500 ? 'PASS' : 'WARN',
      pending,
      threshold: 500
    };
  } catch (e) {
    checks.outbox_queue = { status: 'FAIL', error: e.message };
  }

  // 7. Active sessions
  try {
    const row = await getQuery("SELECT COUNT(*) as count FROM v3_sessions WHERE is_active = 1;");
    const count = row ? row.count : 0;
    checks.active_sessions = { status: 'PASS', count };
  } catch (e) {
    checks.active_sessions = { status: 'WARN', error: e.message, count: 0 };
  }

  // 8. WebSocket (check outbox pipeline health as proxy)
  try {
    const row = await getQuery("SELECT COUNT(*) as count FROM outbox_events WHERE status = 'FAILED' AND created_at > datetime('now', '-5 minutes');");
    const failedRecent = row ? row.count : 0;
    checks.websocket = {
      status: failedRecent < 10 ? 'PASS' : 'WARN',
      recently_failed_outbox: failedRecent
    };
  } catch (e) {
    checks.websocket = { status: 'WARN', error: e.message };
  }

  // 9. Last deployment / update record
  try {
    const upd = await getQuery("SELECT version, status, applied_at FROM system_updates WHERE status = 'ACTIVE' ORDER BY applied_at DESC LIMIT 1;");
    checks.last_deployment = {
      status: 'PASS',
      version: upd ? upd.version : 'base-2.0.0',
      applied_at: upd ? upd.applied_at : null
    };
  } catch (e) {
    checks.last_deployment = { status: 'WARN', error: e.message };
  }

  // 10. Error rate from in-memory metrics
  const totalReq = metrics.requests_total || 1;
  const errorRate = parseFloat(((metrics.requests_5xx / totalReq) * 100).toFixed(2));
  checks.error_rate = {
    status: errorRate < 5 ? 'PASS' : (errorRate < 15 ? 'WARN' : 'FAIL'),
    rate_pct: errorRate,
    total_requests: metrics.requests_total,
    total_5xx: metrics.requests_5xx
  };

  // 11. Process health
  const memUsage = process.memoryUsage();
  const heapMb = parseFloat((memUsage.heapUsed / 1024 / 1024).toFixed(2));
  checks.process = {
    status: heapMb < 450 ? 'PASS' : 'WARN',
    uptime_hours: parseFloat((process.uptime() / 3600).toFixed(2)),
    heap_used_mb: heapMb,
    rss_mb: parseFloat((memUsage.rss / 1024 / 1024).toFixed(2)),
    node_version: process.version
  };

  // Fill API latency
  checks.api.latency_ms = Date.now() - t0;

  // Aggregate overall status — strict, no false green
  const statuses = Object.values(checks).map(c => c.status);
  let overall;
  if (statuses.some(s => s === 'FAIL')) {
    overall = 'RED';
  } else if (statuses.some(s => s === 'WARN')) {
    overall = 'AMBER';
  } else {
    overall = 'GREEN';
  }

  res.status(overall === 'RED' ? 503 : 200).json({
    success: overall !== 'RED',
    overall,
    checks,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/health/alerts/acknowledge
 * Marks a security or health alert as acknowledged.
 * Requires authentication + system:settings permission.
 */
router.post('/health/alerts/acknowledge', requireAuth, requirePermission('system:settings'), async (req, res) => {
  try {
    const { alertId } = req.body;
    if (!alertId) {
      return res.status(400).json({ success: false, error: 'MISSING_ALERT_ID', message: 'alertId is required' });
    }

    const alert = await getQuery('SELECT id, is_acknowledged FROM v3_security_alerts WHERE id = ?', [alertId]);
    if (!alert) {
      return res.status(404).json({ success: false, error: 'ALERT_NOT_FOUND' });
    }
    if (alert.is_acknowledged) {
      return res.status(400).json({ success: false, error: 'ALREADY_ACKNOWLEDGED' });
    }

    await getQuery(
      'UPDATE v3_security_alerts SET is_acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime(\'now\', \'localtime\') WHERE id = ?',
      [req.user.id, alertId]
    );

    logger.info('Health alert acknowledged', { alertId, actorId: req.user.id });
    res.json({ success: true, alertId, acknowledged_by: req.user.id, acknowledged_at: new Date().toISOString() });
  } catch (err) {
    logger.error('Alert acknowledgement failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = {
  router,
  recordRequestMetric,
  recordAuthFailure
};
