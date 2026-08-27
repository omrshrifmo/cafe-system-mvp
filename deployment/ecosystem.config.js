/**
 * PM2 Ecosystem Configuration — Cafe System ERP Production
 * Usage:
 *   pm2 start deployment/ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup  (to enable auto-restart on boot)
 *
 * Requirements: npm install -g pm2
 */
module.exports = {
  apps: [
    {
      name: 'cafe-system',
      script: './src/server.js',
      cwd: '/opt/cafe-system',  // Update to your deployment directory

      // Single-process (fork) mode is required for SQLite single-writer safety.
      // SQLite does not support concurrent writes from multiple processes.
      exec_mode: 'fork',
      instances: 1,

      // Restart behavior
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 2000,
      max_restarts: 10,
      min_uptime: '10s',

      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      wait_ready: false,

      // Log configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/var/log/cafe-system/app-out.log',
      error_file: '/var/log/cafe-system/app-error.log',
      merge_logs: true,
      log_type: 'json',

      // Production environment (all secrets set externally via systemd or env file)
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '127.0.0.1',  // Bind to localhost only — proxy handles external access
        LOG_LEVEL: 'info',
        EXPOSE_DATABASE_PATH: 'false'
        // NOTE: Secrets (SESSION_SECRET, BACKUP_ENCRYPTION_KEY, PACKAGE_SIGNING_KEY)
        // must be set in the OS environment or via systemd EnvironmentFile.
        // NEVER add secrets here — this file may be committed to version control.
      },

      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '0.0.0.0',
        LOG_LEVEL: 'debug',
        EXPOSE_DATABASE_PATH: 'true'
      },

      env_test: {
        NODE_ENV: 'test',
        PORT: 3001,
        HOST: '127.0.0.1',
        LOG_LEVEL: 'error'
      }
    }
  ]
};
