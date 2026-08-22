-- 010_migrate_legacy_users.sql
-- Migrates existing users to the v3_users table

-- Insert all distinct legacy roles into the roles table
INSERT OR IGNORE INTO roles (id, venue_id, name)
SELECT DISTINCT
  'R_' || UPPER(role),
  'V_DEFAULT',
  role
FROM users;

-- Migrate existing users to the v3_users table
INSERT OR IGNORE INTO v3_users (id, venue_id, name, role_id, pin_hash, is_active)
SELECT 
  id,
  'V_DEFAULT',
  name,
  'R_' || UPPER(role),
  pin_hash,
  is_active
FROM users;
