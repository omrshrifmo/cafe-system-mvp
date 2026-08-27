const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const BUILD_INFO_PATH = path.join(__dirname, '..', '.build-info.json');

function generateIdentity() {
  const identity = {
    runtimeId: uuidv4(),
    buildTimestamp: new Date().toISOString(),
    mode: process.env.NODE_ENV || 'development'
  };

  fs.writeFileSync(BUILD_INFO_PATH, JSON.stringify(identity, null, 2), 'utf8');
  console.log(`[Runtime Identity] Generated: ${identity.runtimeId} at ${identity.buildTimestamp}`);
  return identity;
}

if (require.main === module) {
  generateIdentity();
}

module.exports = { generateIdentity, BUILD_INFO_PATH };
