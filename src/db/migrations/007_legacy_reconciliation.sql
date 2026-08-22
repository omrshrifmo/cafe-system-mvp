-- 007_legacy_reconciliation.sql
-- Migrates data from old tables into the V3 schema, then drops old tables.

-- Create default venue and branch
INSERT OR IGNORE INTO venues (id, name, currency, timezone) 
VALUES ('V_DEFAULT', 'كافيه مزاج', 'EGP', 'Africa/Cairo');

INSERT OR IGNORE INTO branches (id, venue_id, name)
VALUES ('B_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي');

-- Create default roles
INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_ADMIN', 'V_DEFAULT', 'SUPER_ADMIN');
INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_STAFF', 'V_DEFAULT', 'STAFF');

-- 007_legacy_reconciliation.sql

-- Create default venue and branch
INSERT OR IGNORE INTO venues (id, name, currency, timezone) 
VALUES ('V_DEFAULT', 'كافيه مزاج', 'EGP', 'Africa/Cairo');

INSERT OR IGNORE INTO branches (id, venue_id, name)
VALUES ('B_DEFAULT', 'V_DEFAULT', 'الفرع الرئيسي');

-- Create default roles
INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_ADMIN', 'V_DEFAULT', 'SUPER_ADMIN');
INSERT OR IGNORE INTO roles (id, venue_id, name) VALUES ('R_STAFF', 'V_DEFAULT', 'STAFF');

-- Legacy tables are preserved for quarantine and reference.
SELECT 1;


