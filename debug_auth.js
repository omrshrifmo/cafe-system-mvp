const request = require('supertest');
const { createApp } = require('./src/app');
const { runMigrations } = require('./src/db/migrator');

(async () => {
  await runMigrations();
  const app = createApp();
  const res = await request(app).get('/api/users');
  console.log('Status:', res.status);
  console.log('Body:', res.body);
})();
