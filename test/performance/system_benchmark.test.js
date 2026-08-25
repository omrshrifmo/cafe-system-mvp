/**
 * Performance, Latency Benchmarks & Concurrency Resilience Test Suite
 * Measures:
 * - Cold start & initialization
 * - POS menu readiness
 * - API p50 / p95 / p99 latencies
 * - SQLite write lock contention with busy_timeout
 * - Print queue throughput
 * - Memory RSS & timer tracking
 */
const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { runMigrations } = require('../../src/db/migrator');
const { runQuery, getQuery } = require('../../src/db/connection');
const { enqueuePrintJob } = require('../../src/domain/printing/service');

describe('Performance & Latency Benchmarks Suite', function () {
  this.timeout(30000);
  let app;
  let ownerToken;

  before(async () => {
    const coldStartStart = Date.now();
    await runMigrations();
    app = createApp();
    const coldStartMs = Date.now() - coldStartStart;

    // Authenticate owner for authenticated benchmarks
    const res = await request(app).post('/api/auth/login').send({ pin: '8802' });
    ownerToken = res.body.token || res.body.data?.token || (res.headers['set-cookie'] ? res.headers['set-cookie'][0].split(';')[0].split('=')[1] : null);

    console.log(`[PERF_METRIC] Database & App Cold Start Time: ${coldStartMs} ms`);
  });

  it('1. POS Menu Catalog Readiness & Latency', async () => {
    const start = Date.now();
    const res = await request(app).get('/api/menu');
    const latencyMs = Date.now() - start;

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(latencyMs < 200, `POS Menu latency must be < 200ms (measured: ${latencyMs}ms)`);
    console.log(`[PERF_METRIC] POS Menu Query Latency: ${latencyMs} ms`);
  });

  it('2. API Latency Distribution (p50, p95, p99 across 50 requests)', async () => {
    const latencies = [];
    const numRequests = 50;

    for (let i = 0; i < numRequests; i++) {
      const start = Date.now();
      const res = await request(app).get('/api/public/tables/1');
      const dur = Date.now() - start;
      assert.strictEqual(res.status, 200);
      latencies.push(dur);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(numRequests * 0.50)];
    const p95 = latencies[Math.floor(numRequests * 0.95)];
    const p99 = latencies[Math.floor(numRequests * 0.99)];

    console.log(`[PERF_METRIC] Public API Latency: p50 = ${p50}ms, p95 = ${p95}ms, p99 = ${p99}ms`);

    assert.ok(p50 < 50, `p50 must be < 50ms (measured: ${p50}ms)`);
    assert.ok(p95 < 150, `p95 must be < 150ms (measured: ${p95}ms)`);
    assert.ok(p99 < 300, `p99 must be < 300ms (measured: ${p99}ms)`);
  });

  it('3. SQLite Concurrent Write Lock Contention & Busy Timeout', async () => {
    // Execute 10 concurrent write transactions against v3_order_sessions
    const start = Date.now();
    const concurrentWrites = Array.from({ length: 10 }).map((_, idx) => {
      const sessionId = `SESSION-PERF-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`;
      return runQuery(`
        INSERT INTO v3_order_sessions (id, branch_id, table_id, created_by, status, subtotal_minor, total_minor)
        VALUES (?, 'B_DEFAULT', 'T-5', '102', 'OPEN', 1000, 1000)
      `, [sessionId]);
    });

    const results = await Promise.allSettled(concurrentWrites);
    const durationMs = Date.now() - start;

    const successfulWrites = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[PERF_METRIC] 10 Concurrent Writes Completed in ${durationMs} ms (Success: ${successfulWrites}/10)`);

    assert.strictEqual(successfulWrites, 10, 'All concurrent writes must succeed with busy_timeout handling');
  });

  it('4. Print Queue Enqueue Throughput', async () => {
    const start = Date.now();
    const numJobs = 20;

    for (let i = 0; i < numJobs; i++) {
      await enqueuePrintJob({
        jobType: 'RECEIPT',
        payload: { order_id: 1000 + i, total_amount: 50 },
        idempotencyKey: `PERF_PRINT_JOB_${Date.now()}_${i}`
      });
    }

    const durationMs = Date.now() - start;
    const opsPerSec = (numJobs / (durationMs / 1000)).toFixed(1);
    console.log(`[PERF_METRIC] Print Queue Throughput: ${numJobs} jobs in ${durationMs} ms (${opsPerSec} jobs/sec)`);

    assert.ok(durationMs < 1000, `Enqueueing ${numJobs} jobs must complete in < 1000ms`);
  });

  it('5. Process Memory RSS & Health Verification', () => {
    const memoryUsage = process.memoryUsage();
    const rssMb = (memoryUsage.rss / (1024 * 1024)).toFixed(2);
    const heapUsedMb = (memoryUsage.heapUsed / (1024 * 1024)).toFixed(2);

    console.log(`[PERF_METRIC] Memory RSS: ${rssMb} MB, Heap Used: ${heapUsedMb} MB`);

    // RSS should be well under the 512MB enterprise threshold
    assert.ok(memoryUsage.rss < 512 * 1024 * 1024, `RSS Memory (${rssMb}MB) must be < 512MB`);
  });

});
