-- Migration 035: Add category, user_id, expense_date to daily_expenses
ALTER TABLE daily_expenses ADD COLUMN category TEXT DEFAULT 'OPERATIONAL';
ALTER TABLE daily_expenses ADD COLUMN user_id INTEGER;
ALTER TABLE daily_expenses ADD COLUMN expense_date TEXT;
