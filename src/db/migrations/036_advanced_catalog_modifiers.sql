-- 036_advanced_catalog_modifiers.sql: Modifiers, Flavors, Surprise Mix, and Prep Instructions
ALTER TABLE menu_items ADD COLUMN has_sugar_options INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN has_roast_options INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN available_flavors TEXT;
ALTER TABLE menu_items ADD COLUMN is_surprise_mix INTEGER NOT NULL DEFAULT 0;
ALTER TABLE menu_items ADD COLUMN prep_instructions TEXT;
