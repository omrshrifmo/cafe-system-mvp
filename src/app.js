/**
 * Express Application Factory
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const requestIdMiddleware = require('./http/middleware/request-id');
const { authMiddleware } = require('./http/middleware/auth');
const { enforceRegistry } = require('./http/middleware/registry');
const { modeMiddleware } = require('./http/middleware/mode');
const errorHandler = require('./http/middleware/errors');
const envelopeMiddleware = require('./http/middleware/envelope');

// Route Modules
const authRoutes = require('./http/routes/auth');
const catalogRoutes = require('./http/routes/catalog');
const ordersRoutes = require('./http/routes/orders');
const paymentsRoutes = require('./http/routes/payments');
const tablesRoutes = require('./http/routes/tables');
const inventoryRoutes = require('./http/routes/inventory');
const shiftsRoutes = require('./http/routes/shifts');
const reportsRoutes = require('./http/routes/reports');
const configRoutes = require('./http/routes/config');
const crmRoutes = require('./http/routes/crm');
const syncRoutes = require('./http/routes/sync');
const printRoutes = require('./http/routes/print');
const hrRoutes = require('./http/routes/hr');
const usersRoutes = require('./http/routes/users');
const setupRoutes = require('./http/routes/setup');
const adminRoutes = require('./http/routes/admin');
const updatesRoutes = require('./http/routes/updates');
const auditRoutes = require('./http/routes/audit');
const { securityHeaders, strictCors, csrfProtection } = require('./http/middleware/security');
const { router: healthRoutes, recordRequestMetric } = require('./http/routes/health');

function createApp() {
  const app = express();

  // Security Headers & Strict CORS
  app.use(securityHeaders);
  app.use(strictCors);

  // Request Metrics Tracking
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      recordRequestMetric(res.statusCode, Date.now() - start);
    });
    next();
  });

  // Basic Middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(requestIdMiddleware);
  app.use(envelopeMiddleware);
  app.use(modeMiddleware);
  app.use(authMiddleware);

  // Protect static HTML pages (Phase 1)
  app.use((req, res, next) => {
    if (req.path.endsWith('.html') && req.path !== '/' && req.path !== '/index.html') {
      if (!req.user) {
        return res.redirect('/');
      }
    }
    next();
  });

  // Serve static assets from public/ directory
  app.use(express.static(path.join(__dirname, '../public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
    etag: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html') || path.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));

  // Enforce Default Deny Registry on API paths
  app.use(enforceRegistry);

  // API Routes Mount
  app.use('/api/auth', authRoutes);
  app.use('/api', hrRoutes);
  app.use('/api', usersRoutes);
  app.use('/api', catalogRoutes);
  app.use('/api', ordersRoutes);
  app.use('/api', paymentsRoutes);
  app.use('/api', tablesRoutes);
  app.use('/api', inventoryRoutes);
  app.use('/api', shiftsRoutes);
  app.use('/api', reportsRoutes);
  app.use('/api', configRoutes);
  app.use('/api', crmRoutes);
  app.use('/api', syncRoutes);
  app.use('/api', printRoutes);
  app.use('/api/setup', setupRoutes);
  app.use('/api/admin/updates', updatesRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/activity-ledger', auditRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', healthRoutes);

  // Health check endpoint
  app.get('/healthz', (req, res) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'cafe-system-production'
    });
  });

  // Build info endpoint with full provenance metadata
  const crypto = require('crypto');
  const SERVER_INSTANCE_ID = crypto.randomUUID();
  const PROCESS_START_TIME = new Date().toISOString();

  function getLatestMigration() {
    try {
      const migDir = path.join(__dirname, 'db/migrations');
      const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
      if (files.length > 0) {
        const latest = files[files.length - 1];
        const match = latest.match(/^(\d+)/);
        return {
          schemaVersion: latest,
          migrationVersion: match ? match[1] : '019'
        };
      }
    } catch (e) { }
    return { schemaVersion: '019_reporting_and_equity.sql', migrationVersion: '019' };
  }

  // Truth source for provenance: the migrations ACTUALLY APPLIED in the active
  // database (schema_migrations table), not the migrations directory listing.
  // Falls back to the directory-derived value only when the table is unreadable.
  let _appliedMigrationCache = { at: 0, dbPath: null, value: null };

  function queryAppliedMigration(dbPath) {
    return new Promise((resolve) => {
      try {
        const sqlite3 = require('sqlite3');
        const resolved = path.isAbsolute(dbPath || '') ? dbPath : path.join(__dirname, '..', dbPath || 'cafe.db');
        const db = new sqlite3.Database(resolved, sqlite3.OPEN_READONLY);
        const timer = setTimeout(() => { try { db.close(); } catch (e) { } resolve(null); }, 2000);
        db.get('SELECT version, checksum FROM schema_migrations ORDER BY version DESC LIMIT 1', (err, row) => {
          clearTimeout(timer);
          try { db.close(); } catch (e) { }
          resolve(err || !row ? null : { version: row.version, checksum: row.checksum });
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function getAppliedMigrationCached(dbPath) {
    const now = Date.now();
    if (_appliedMigrationCache.value && _appliedMigrationCache.dbPath === dbPath && now - _appliedMigrationCache.at < 15000) {
      return _appliedMigrationCache.value;
    }
    const value = await queryAppliedMigration(dbPath);
    if (value) {
      _appliedMigrationCache = { at: now, dbPath, value };
    }
    return value;
  }

  // Service worker identity derived from the actual served file content.
  function getServiceWorkerInfo() {
    try {
      const swPath = path.join(__dirname, '../public/sw.js');
      const content = fs.readFileSync(swPath, 'utf8');
      const match = content.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
      return {
        version: match ? match[1] : 'unknown',
        sha256: crypto.createHash('sha256').update(content).digest('hex')
      };
    } catch (e) {
      return { version: 'unknown', sha256: null };
    }
  }

  function getGitMetadata() {
    let commit = 'e8224a1ea063b8ee0010586664ac9ee9570bd2ad';
    let branch = 'main';
    let repo = 'omrshrifmo/cafe-system-mvp';
    try {
      const { execSync } = require('child_process');
      commit = execSync('git rev-parse HEAD', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
      branch = execSync('git branch --show-current', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim() || 'main';
      const remote = execSync('git config --get remote.origin.url', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).trim();
      if (remote) {
        const repoMatch = remote.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
        if (repoMatch) repo = repoMatch[1];
      }
    } catch (e) { }
    return { commit, branch, repo };
  }

  const { commit: COMMIT_SHA, branch: GIT_BRANCH, repo: REPO_NAME } = getGitMetadata();
  const { schemaVersion: DIR_SCHEMA_VERSION, migrationVersion: DIR_MIGRATION_VERSION } = getLatestMigration();
  const BUILD_ID = `build-${COMMIT_SHA.slice(0, 8)}-v2`;
  const { version: SW_VERSION, sha256: SW_SHA256 } = getServiceWorkerInfo();

  app.get('/api/build-info', async (req, res) => {
    const env = require('./config/env');
    const { getMode, getDatabasePath } = require('./domain/system/modeService');
    const activeDbPath = getDatabasePath();
    const dbIdentity = path.basename(activeDbPath || 'cafe.db');
    const currentMode = getMode();
    const isFixture = dbIdentity.includes('fixture') || dbIdentity.includes('test') || dbIdentity.includes('demo');

    // Applied-migration truth from the live database; directory value only as fallback.
    let applied = null;
    try {
      applied = await getAppliedMigrationCached(activeDbPath);
    } catch (e) {
      applied = null;
    }
    const appliedVersion = applied ? applied.version : null;
    const appliedChecksum = applied ? applied.checksum : null;
    const appliedSource = applied ? 'database' : 'directory-fallback';
    const schemaVersion = applied ? applied.version : DIR_SCHEMA_VERSION;
    const migrationVersion = applied
      ? ((String(applied.version).match(/^(\d+)/) || [null, applied.version])[1])
      : DIR_MIGRATION_VERSION;

    res.setHeader('X-Build-Id', BUILD_ID);
    res.setHeader('X-Commit-Sha', COMMIT_SHA);
    res.setHeader('X-Branch', GIT_BRANCH);
    res.setHeader('X-Repository', REPO_NAME);
    res.setHeader('X-Schema-Version', schemaVersion);
    res.setHeader('X-Migration-Version', migrationVersion);
    res.setHeader('X-Service-Worker-Version', SW_VERSION);
    res.setHeader('X-Service-Worker-Sha256', SW_SHA256 || '');
    res.setHeader('X-Applied-Migration-Source', appliedSource);
    res.setHeader('X-Environment-Mode', env.NODE_ENV || 'development');
    res.setHeader('X-Database-Identity', dbIdentity);
    res.setHeader('X-Process-Start-Time', PROCESS_START_TIME);
    res.setHeader('X-Server-Instance-Id', SERVER_INSTANCE_ID);
    res.setHeader('X-App-Mode', currentMode);
    res.setHeader('X-Fixture-Id', isFixture ? dbIdentity : 'NONE');
    res.setHeader('X-Port', String(env.PORT || 3000));
    res.setHeader('X-Process-Id', String(process.pid));

    res.json({
      status: 'OK',
      buildId: BUILD_ID,
      commitSha: COMMIT_SHA,
      commit: COMMIT_SHA,
      branch: GIT_BRANCH,
      repository: REPO_NAME,
      schemaVersion: schemaVersion,
      migrationVersion: migrationVersion,
      appliedMigrationVersion: appliedVersion,
      appliedMigrationSource: appliedSource,
      appliedMigrationChecksum: appliedChecksum,
      serviceWorkerVersion: SW_VERSION,
      serviceWorkerSha256: SW_SHA256,
      environmentMode: env.NODE_ENV || 'development',
      environment: env.NODE_ENV || 'development',
      databaseIdentity: dbIdentity,
      databasePath: activeDbPath,
      fixtureId: isFixture ? dbIdentity : null,
      processStartTime: PROCESS_START_TIME,
      serverInstanceId: SERVER_INSTANCE_ID,
      appMode: currentMode,
      port: env.PORT || 3000,
      process: {
        pid: process.pid,
        nodeVersion: process.version,
        startTime: PROCESS_START_TIME,
        uptimeSeconds: Math.floor(process.uptime())
      },
      timestamp: new Date().toISOString()
    });
  });

  // 404 Fallback for Unmatched API / Page Routes (Distinguishable from 403 Forbidden & 401 Auth)
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      data: null,
      error: `NOT_FOUND: المسار المطلوب غير موجود [${req.method} ${req.originalUrl}]`,
      code: 'NOT_FOUND',
      requestId: req.id
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
