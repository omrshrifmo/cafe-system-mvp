/**
 * Regression tests for the /api/build-info provenance contract (Prompt 0).
 *
 * Guarantees under test:
 *  - The endpoint exposes build ID, commit SHA, branch, schema/migration version,
 *    service-worker version + hash, environment mode, database identity,
 *    process start time and server instance ID.
 *  - Migration version is sourced from the APPLIED schema_migrations table
 *    ('database') whenever that table is readable — never silently from the
 *    migrations directory listing alone.
 *  - No secrets or raw session identifiers are disclosed.
 */
const assert = require('assert');
const request = require('supertest');
const { execSync } = require('child_process');
const { createApp } = require('../../src/app');

describe('Build Info Provenance Contract', function () {
    this.timeout(15000);
    const app = createApp();

    let body;
    let headers;

    before(async () => {
        const res = await request(app).get('/api/build-info').expect(200);
        body = res.body.data || res.body; // envelope-aware
        headers = res.headers;
    });

    it('exposes a build id tied to the current git HEAD', () => {
        const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        assert.strictEqual(body.commitSha, head, 'commitSha must equal checked-out HEAD');
        assert.strictEqual(body.buildId, `build-${head.slice(0, 8)}-v2`);
        assert.strictEqual(headers['x-commit-sha'], head);
        assert.strictEqual(headers['x-build-id'], body.buildId);
    });

    it('exposes branch, repository, environment mode and port', () => {
        assert.strictEqual(body.branch, 'main');
        assert.ok(body.repository && body.repository.length > 0);
        assert.ok(['development', 'production', 'test'].includes(body.environmentMode));
        assert.strictEqual(typeof body.port, 'number');
    });

    it('sources schema/migration version from the applied database migrations', () => {
        assert.ok(body.schemaVersion, 'schemaVersion must be present');
        assert.ok(body.migrationVersion, 'migrationVersion must be present');
        assert.ok(
            body.appliedMigrationSource === 'database' || body.appliedMigrationSource === 'directory-fallback',
            `unexpected appliedMigrationSource: ${body.appliedMigrationSource}`
        );
        if (body.appliedMigrationSource === 'database') {
            assert.ok(body.appliedMigrationChecksum, 'applied checksum must be present when sourced from database');
            assert.ok(/^\d+/.test(String(body.appliedMigrationVersion)), 'applied version must be numeric-prefixed');
        }
        assert.strictEqual(headers['x-schema-version'], body.schemaVersion);
        assert.strictEqual(headers['x-migration-version'], body.migrationVersion);
    });

    it('derives service worker identity from the served sw.js content', () => {
        assert.match(body.serviceWorkerVersion, /^cafe-os-v/);
        if (body.serviceWorkerSha256) {
            assert.match(body.serviceWorkerSha256, /^[a-f0-9]{64}$/);
        }
        assert.ok('serviceWorkerSha256' in body, 'serviceWorkerSha256 field must exist');
    });

    it('exposes database identity, process start time and server instance id', () => {
        assert.ok(body.databaseIdentity, 'databaseIdentity must be present');
        assert.ok(body.processStartTime, 'processStartTime must be present');
        assert.match(body.serverInstanceId, /^[a-f0-9-]{36}$/);
        assert.strictEqual(headers['x-database-identity'], body.databaseIdentity);
        assert.strictEqual(headers['x-process-start-time'], body.processStartTime);
        assert.strictEqual(headers['x-server-instance-id'], body.serverInstanceId);
    });

    it('does not disclose secrets, PINs or raw session identifiers', () => {
        const serialized = JSON.stringify(body).toLowerCase();
        for (const forbidden of ['sessionid', 'session_id', 'pin_hash', 'pinhash', 'secret', 'password']) {
            assert.ok(!serialized.includes(forbidden), `build-info must not contain "${forbidden}"`);
        }
    });
});