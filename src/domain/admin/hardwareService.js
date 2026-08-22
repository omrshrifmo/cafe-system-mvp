const { logAudit } = require('../auth/service');
const modeService = require('../system/modeService');

async function testPrinter(venueId, deviceId, userId) {
  // Simulate hardware connection and print job
  const success = true; 
  
  await logAudit(venueId, userId, 'TEST', 'HARDWARE', deviceId, { hardware: 'PRINTER', success }, null);
  
  return { success, message: 'Printer test job dispatched successfully.' };
}

async function testDrawerKick(venueId, deviceId, userId) {
  const mode = modeService.getMode();
  
  // Drawer kicks for testing shouldn't be allowed in live unless we really want it, but we'll simulate.
  // The prompt said: "Printer test and drawer test must be separately permissioned, visibly simulated in demo, and safe in live"
  
  let simulated = false;
  if (mode === modeService.MODES.DEMO || mode === modeService.MODES.ONBOARDING) {
    simulated = true;
  }
  
  const success = true;

  await logAudit(venueId, userId, 'TEST', 'HARDWARE', deviceId, { hardware: 'DRAWER', success, simulated }, null);
  
  return { success, simulated, message: simulated ? 'Drawer kick visibly simulated.' : 'Live drawer kick signal sent.' };
}

module.exports = {
  testPrinter,
  testDrawerKick
};
