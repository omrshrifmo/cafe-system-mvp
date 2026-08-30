-- Migration 034: Recipes indirect cost column for packaging/cups margin tracking
ALTER TABLE recipes ADD COLUMN indirect_cost REAL DEFAULT 0;
