const { getMode, MODES } = require('../../domain/system/modeService');

function modeMiddleware(req, res, next) {
  const currentMode = getMode();

  // Inject current mode into all responses
  res.setHeader('X-App-Mode', currentMode);

  // If in ONBOARDING mode, block all API requests except for setup routes, health checks and metrics
  if (currentMode === MODES.ONBOARDING) {
    if (req.path.startsWith('/api/') && 
        !req.path.startsWith('/api/setup') && 
        !req.path.startsWith('/api/health') && 
        req.path !== '/api/metrics' && 
        req.path !== '/api/build-info') {
      return res.status(403).json({
        success: false,
        error: 'NEEDS_ONBOARDING: يرجى إكمال إعداد النظام أولاً',
        code: 'NEEDS_ONBOARDING'
      });
    }
  }

  next();
}

module.exports = {
  modeMiddleware
};
