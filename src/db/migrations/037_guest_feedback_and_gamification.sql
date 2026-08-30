-- Migration 037: Guest Feedback enhancements & Gamification columns
ALTER TABLE customer_feedback ADD COLUMN table_number TEXT;
ALTER TABLE customer_feedback ADD COLUMN is_flagged BOOLEAN DEFAULT 0;
