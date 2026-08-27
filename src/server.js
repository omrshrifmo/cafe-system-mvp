/**
 * Production Server Lifecycle & Bootstrapping
 */
const http = require('http');
const { createApp } = require('./app');
const { runMigrations } = require('./db/migrator');
const { closeDb } = require('./db/connection');
const { setupWebSocketServer } = require('./realtime/websocket');
const { startPrintWorker, stopPrintWorker } = require('./jobs/print-worker');
const env = require('./config/env');
const logger = require('./observability/logger');

async function startServer() {
  try {
    logger.info('Initializing Cafe System Database Migrations...');
    await runMigrations();

    // Seed onboarding_state in system_config if missing (first-run detection)
    const { seedOnboardingState } = require('./domain/system/onboardingState');
    await seedOnboardingState();

    const app = createApp();
    const server = http.createServer(app);

    // Setup Realtime WebSockets
    setupWebSocketServer(server);

    // Start background workers
    startPrintWorker();

    server.listen(env.PORT, env.HOST, () => {
      logger.info(`🚀 Cafe System ERP Server running on http://${env.HOST}:${env.PORT}`);
    });

    // Graceful Shutdown Handlers
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Gracefully shutting down...`);
      stopPrintWorker();

      server.close(async () => {
        logger.info('HTTP & WebSocket servers closed.');
        try {
          const { runQuery } = require('./db/connection');
          await runQuery('PRAGMA wal_checkpoint(TRUNCATE);');
          logger.info('WAL checkpoint TRUNCATE completed successfully.');
        } catch (e) {
          logger.warn('WAL checkpoint note:', { error: e.message });
        }
        await closeDb();
        logger.info('Database connection closed cleanly. Exiting.');
        process.exit(0);
      });

      // Force shutdown after 10s if hanging
      setTimeout(() => {
        logger.error('Force shutdown after timeout.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    return { app, server };
  } catch (err) {
    logger.error('Failed to start server:', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
