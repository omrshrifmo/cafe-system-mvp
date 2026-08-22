/**
 * Express Application Factory
 */
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const requestIdMiddleware = require('./http/middleware/request-id');
const { authMiddleware } = require('./http/middleware/auth');
const { enforceRegistry } = require('./http/middleware/registry');
const errorHandler = require('./http/middleware/errors');

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
const usersRoutes = require('./http/routes/users');

function createApp() {
  const app = express();

  // Basic Middlewares
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
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

  // Health check endpoint
  app.get('/healthz', (req, res) => {
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      service: 'cafe-system-production'
    });
  });

  // Build info endpoint (Phase 0)
  app.get('/api/build-info', (req, res) => {
    res.setHeader('X-Build-Id', 'build-v2-remediated');
    res.json({
      status: 'OK',
      buildId: 'build-v2-remediated',
      timestamp: new Date().toISOString()
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
