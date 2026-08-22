-- 005_canonical_prices.sql: Ensure all standard menu items have canonical non-zero prices in minor units

-- Default categories if not exists
INSERT OR IGNORE INTO menu_categories (id, name, name_en, icon, color, sort_order, is_active) VALUES
(1, 'مشروبات ساخنة', 'Hot Drinks', '☕', '#f59e0b', 1, 1),
(2, 'مشروبات باردة', 'Cold Drinks', '🥤', '#06b6d4', 2, 1),
(3, 'حلويات ومخبوزات', 'Desserts', '🍰', '#ec4899', 3, 1),
(4, 'مأكولات وسندوتشات', 'Food', '🍔', '#10b981', 4, 1),
(5, 'شيشة', 'Shisha', '💨', '#8b5cf6', 5, 1);

-- Default menu items with proper category IDs and departments
INSERT OR IGNORE INTO menu_items (id, category_id, name, name_en, department, is_available, is_featured, sort_order) VALUES
(1, 1, 'إسبريسو سينجل', 'Single Espresso', 'BARISTA', 1, 1, 1),
(2, 1, 'إسبريسو دبل', 'Double Espresso', 'BARISTA', 1, 1, 2),
(3, 1, 'قهوة تركي سينجل', 'Single Turkish Coffee', 'BARISTA', 1, 1, 3),
(4, 1, 'قهوة تركي دبل', 'Double Turkish Coffee', 'BARISTA', 1, 1, 4),
(5, 1, 'كابتشينو', 'Cappuccino', 'BARISTA', 1, 1, 5),
(6, 1, 'لاتيه ساخن', 'Hot Latte', 'BARISTA', 1, 1, 6),
(7, 1, 'شاي كشري', 'Black Tea', 'BARISTA', 1, 1, 7),
(8, 2, 'أيس لاتيه', 'Iced Latte', 'BARISTA', 1, 1, 8),
(9, 2, 'موهيتو ليمون نعناع', 'Lemon Mint Mojito', 'BARISTA', 1, 1, 9),
(10, 3, 'تشيز كيك لوتس', 'Lotus Cheesecake', 'KITCHEN', 1, 1, 10),
(11, 4, 'كلوب ساندوتش', 'Club Sandwich', 'KITCHEN', 1, 1, 11),
(12, 5, 'شيشة سلوم', 'Salloum Shisha', 'SHISHA', 1, 1, 12),
(13, 5, 'شيشة فواكه', 'Flavored Shisha', 'SHISHA', 1, 1, 13);

-- Active prices for items if not present (Minor units: 100 = 1.00 EGP)
INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 1, 3500, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 1 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 2, 4500, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 2 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 3, 3000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 3 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 4, 4000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 4 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 5, 5500, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 5 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 6, 5000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 6 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 7, 2000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 7 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 8, 6000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 8 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 9, 4500, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 9 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 10, 6500, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 10 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 11, 12000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 11 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 12, 8000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 12 AND valid_to IS NULL);

INSERT OR IGNORE INTO menu_prices (menu_item_id, amount_minor, currency)
SELECT 13, 10000, 'ج.م' WHERE NOT EXISTS (SELECT 1 FROM menu_prices WHERE menu_item_id = 13 AND valid_to IS NULL);
