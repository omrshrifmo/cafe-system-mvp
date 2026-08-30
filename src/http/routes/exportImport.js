/**
 * SaaS Export & Import Hub HTTP Routes
 * Provides streaming UTF-8 BOM CSV exports for Excel compatibility and CSV menu bulk import
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const csvParser = require('csv-parser');
const { Readable } = require('stream');
const { allQuery, getQuery, runQuery } = require('../../db/connection');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../../observability/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB max
});

function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Export Sales (CSV with UTF-8 BOM for Arabic Excel support)
// ─────────────────────────────────────────────────────────────────────────────
router.get(['/export/sales', '/export/orders'], requireAuth, requirePermission('reports:financial'), async (req, res, next) => {
  try {
    const sessions = await allQuery(`
      SELECT 
        s.id,
        s.public_ref,
        s.order_type,
        COALESCE(s.table_id, 0) as table_id,
        s.subtotal_minor,
        s.service_minor,
        s.tax_minor,
        s.discount_minor,
        s.total_minor,
        s.currency,
        s.status,
        s.created_at,
        s.closed_at,
        COALESCE(p.method, 'CASH') as payment_method
      FROM order_sessions s
      LEFT JOIN payments p ON s.id = p.session_id
      ORDER BY s.id DESC
      LIMIT 5000
    `);

    // Standard UTF-8 Byte Order Mark (BOM) for Excel
    const BOM = '\uFEFF';
    const headers = [
      'رقم الفاتورة',
      'المرجع العام',
      'نوع الطلب',
      'رقم الطاولة',
      'المجموع الفرعي',
      'رسوم الخدمة',
      'الضريبة',
      'الخصم',
      'الإجمالي',
      'العملة',
      'طريقة الدفع',
      'حالة الفاتورة',
      'تاريخ الإنشاء',
      'تاريخ الإغلاق'
    ];

    const rows = [headers.map(escapeCsv).join(',')];

    for (const row of sessions) {
      const orderTypeAr = row.order_type === 'DINE_IN' ? 'صالة' : row.order_type === 'TAKEAWAY' ? 'سفري / تيك أواي' : row.order_type === 'DELIVERY' ? 'توصيل' : row.order_type;
      const statusAr = row.status === 'CLOSED' ? 'مسدد ومغلق' : row.status === 'OPEN' ? 'مفتوح' : row.status === 'VOID' ? 'ملغي' : row.status;
      const methodAr = row.payment_method === 'CASH' ? 'نقدي (Cash)' : row.payment_method === 'CARD' ? 'بطاقة بنكية' : row.payment_method === 'WALLET' ? 'محفظة إلكترونية' : row.payment_method === 'HOUSE_GUEST' ? 'ضيافة' : row.payment_method;

      rows.push([
        escapeCsv(row.id),
        escapeCsv(row.public_ref || `INV-${row.id}`),
        escapeCsv(orderTypeAr),
        escapeCsv(row.table_id > 0 ? `طاولة ${row.table_id}` : 'بدون طاولة'),
        escapeCsv((row.subtotal_minor / 100).toFixed(2)),
        escapeCsv((row.service_minor / 100).toFixed(2)),
        escapeCsv((row.tax_minor / 100).toFixed(2)),
        escapeCsv((row.discount_minor / 100).toFixed(2)),
        escapeCsv((row.total_minor / 100).toFixed(2)),
        escapeCsv(row.currency || 'ج.م'),
        escapeCsv(methodAr),
        escapeCsv(statusAr),
        escapeCsv(row.created_at || ''),
        escapeCsv(row.closed_at || '')
      ].join(','));
    }

    const csvContent = BOM + rows.join('\r\n');
    const filename = `mazaj_sales_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Export Inventory (CSV with UTF-8 BOM for Arabic Excel support)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/export/inventory', requireAuth, requirePermission('inventory:view'), async (req, res, next) => {
  try {
    const items = await allQuery(`
      SELECT 
        i.id,
        i.name,
        i.category,
        i.unit,
        i.min_limit,
        i.cost_per_unit_minor,
        i.current_stock_microunits,
        i.is_active,
        i.created_at,
        s.name as supplier_name
      FROM inventory_items i
      LEFT JOIN suppliers s ON i.default_supplier_id = s.id
      ORDER BY i.id ASC
    `);

    const BOM = '\uFEFF';
    const headers = [
      'كود المادة',
      'اسم الصنف / الخامة',
      'القسم والتصنيف',
      'وحدة القياس',
      'الرصيد الفعلي الحالي',
      'حد الطلب الأدنى',
      'سعر التكلفة للوحدة',
      'المورد الافتراضي',
      'حالة التفعيل',
      'تاريخ التسجيل'
    ];

    const rows = [headers.map(escapeCsv).join(',')];

    for (const row of items) {
      const currentStock = (row.current_stock_microunits / 1000000.0).toFixed(3);
      const unitCost = (row.cost_per_unit_minor / 100.0).toFixed(2);
      const statusAr = row.is_active ? 'نشط' : 'معطل';

      rows.push([
        escapeCsv(row.id),
        escapeCsv(row.name),
        escapeCsv(row.category || 'عام'),
        escapeCsv(row.unit || 'وحدة'),
        escapeCsv(currentStock),
        escapeCsv(row.min_limit || 0),
        escapeCsv(unitCost),
        escapeCsv(row.supplier_name || 'غير محدد'),
        escapeCsv(statusAr),
        escapeCsv(row.created_at || '')
      ].join(','));
    }

    const csvContent = BOM + rows.join('\r\n');
    const filename = `mazaj_inventory_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Download Master Setup Template Archive (GET /api/export/templates/master)
// ─────────────────────────────────────────────────────────────────────────────
const zlib = require('zlib');

const crcTable = (() => {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function createZipBuffer(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const dataBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8');
    const crc = crc32(dataBuf);
    const uncompressedSize = dataBuf.length;
    const compressedData = zlib.deflateRawSync(dataBuf);
    const compressedSize = compressedData.length;

    const localHdr = Buffer.alloc(30);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4);
    localHdr.writeUInt16LE(0x0800, 6);
    localHdr.writeUInt16LE(8, 8);
    localHdr.writeUInt16LE(0, 10);
    localHdr.writeUInt16LE(0, 12);
    localHdr.writeUInt32LE(crc, 14);
    localHdr.writeUInt32LE(compressedSize, 18);
    localHdr.writeUInt32LE(uncompressedSize, 22);
    localHdr.writeUInt16LE(nameBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);

    const localChunk = Buffer.concat([localHdr, nameBuf, compressedData]);
    localHeaders.push(localChunk);

    const centralHdr = Buffer.alloc(46);
    centralHdr.writeUInt32LE(0x02014b50, 0);
    centralHdr.writeUInt16LE(20, 4);
    centralHdr.writeUInt16LE(20, 6);
    centralHdr.writeUInt16LE(0x0800, 8);
    centralHdr.writeUInt16LE(8, 10);
    centralHdr.writeUInt16LE(0, 12);
    centralHdr.writeUInt16LE(0, 14);
    centralHdr.writeUInt32LE(crc, 16);
    centralHdr.writeUInt32LE(compressedSize, 20);
    centralHdr.writeUInt32LE(uncompressedSize, 24);
    centralHdr.writeUInt16LE(nameBuf.length, 28);
    centralHdr.writeUInt16LE(0, 30);
    centralHdr.writeUInt16LE(0, 32);
    centralHdr.writeUInt16LE(0, 34);
    centralHdr.writeUInt16LE(0, 36);
    centralHdr.writeUInt32LE(0, 38);
    centralHdr.writeUInt32LE(offset, 42);

    const centralChunk = Buffer.concat([centralHdr, nameBuf]);
    centralHeaders.push(centralChunk);

    offset += localChunk.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, b) => sum + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

router.get(['/export/templates/master', '/export/template/master'], async (req, res, next) => {
  try {
    const BOM = '\uFEFF';

    const menuTemplate = BOM + [
      'sku,name,name_en,category,department,price,description,has_sugar_options,has_roast_options,available_flavors,is_surprise_mix,prep_instructions',
      'CF-001,لاتيه,Latte,مشروبات ساخنة,BARISTA,45.00,إسبريسو بالحليب المبخر والرغوة,1,1,"[""فانيليا"",""كراميل"",""بندق""]",0,تسخين الحليب لدرجة 65 مع رغوة مخملية',
      'SH-001,شيشة ميكس مزاج,Mazaj Shisha Mix,شيشة ومعسل,SHISHA,75.00,خلطة شيشة فاخرة خاصة بالبار,0,0,"",1,خلطة حجر مزدوج بنكهات المحطة الخاصة'
    ].join('\r\n');

    const ingredientsTemplate = BOM + [
      'name,category,unit,min_limit,cost_per_unit_egp,current_stock',
      'بن برازيلي وسط,بن وخامات,كجم,5.0,350.00,20.0',
      'حليب كامل الدسم,ألبان,لتر,10.0,40.00,50.0',
      'سيرب فانيليا,نكهات ومحسنات,لتر,2.0,180.00,6.0',
      'معسل تفاحتين فاخر,تبغ ومعسل,كجم,3.0,400.00,15.0',
      'فحم شيشة طبيعي,مستلزمات شيشة,كجم,10.0,50.00,40.0'
    ].join('\r\n');

    const recipesTemplate = BOM + [
      'menu_item_name,ingredient_name,quantity,unit',
      'لاتيه,بن برازيلي وسط,0.018,كجم',
      'لاتيه,حليب كامل الدسم,0.200,لتر',
      'شيشة ميكس مزاج,معسل تفاحتين فاخر,0.025,كجم',
      'شيشة ميكس مزاج,فحم شيشة طبيعي,0.050,كجم'
    ].join('\r\n');

    const zipBuffer = createZipBuffer([
      { name: 'menu.csv', content: menuTemplate },
      { name: 'ingredients.csv', content: ingredientsTemplate },
      { name: 'recipes.csv', content: recipesTemplate }
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Mazaj_Master_Setup_Templates.zip"');
    res.status(200).send(zipBuffer);
  } catch (err) {
    next(err);
  }
});

// Helper: parse CSV stream from Buffer
async function parseCsvBuffer(buffer) {
  const results = [];
  let str = buffer.toString('utf8');
  if (str.charCodeAt(0) === 0xFEFF) {
    str = str.slice(1);
  }
  const stream = Readable.from(str);
  await new Promise((resolve, reject) => {
    stream
      .pipe(csvParser())
      .on('data', (data) => results.push(data))
      .on('end', resolve)
      .on('error', reject);
  });
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mega Bulk-Import Hub (/api/import/master and /api/import/menu)
// ─────────────────────────────────────────────────────────────────────────────
router.post(['/import/master', '/import/menu'], requireAuth, requirePermission('menu:write'), upload.any(), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, error: 'يرجى إرفاق ملف CSV واحد على الأقل' });
    }

    let ingredientsFile = null;
    let menuFile = null;
    let recipesFile = null;

    // Distinguish uploaded files by fieldname, filename, or columns
    for (const f of files) {
      const field = (f.fieldname || '').toLowerCase();
      const fname = (f.originalname || '').toLowerCase();

      if (field === 'ingredients' || fname.includes('ingredient') || fname.includes('خام') || fname.includes('مواد')) {
        ingredientsFile = f;
      } else if (field === 'recipes' || fname.includes('recipe') || fname.includes('وصف') || fname.includes('bom')) {
        recipesFile = f;
      } else if (field === 'menu' || fname.includes('menu') || fname.includes('منيو') || fname.includes('اصناف') || fname.includes('صنف') || field === 'file') {
        menuFile = f;
      } else {
        if (!menuFile) menuFile = f;
      }
    }

    let importedIngredientsCount = 0;
    let importedMenuCount = 0;
    let importedRecipesCount = 0;

    // 1. Ingest Ingredients FIRST -> BOM Stock
    if (ingredientsFile) {
      const ingRows = await parseCsvBuffer(ingredientsFile.buffer);
      for (const row of ingRows) {
        const name = (row['name'] || row['اسم_الخامة'] || row['اسم'] || row['الاسم'] || '').trim();
        if (!name) continue;

        const category = (row['category'] || row['القسم'] || row['التصنيف'] || 'خامات عامة').trim();
        const unit = (row['unit'] || row['وحدة_القياس'] || row['الوحدة'] || 'وحدة').trim();
        const minLimit = parseFloat(row['min_limit'] || row['حد_الطلب'] || row['الحد_الأدنى'] || '0') || 0;
        const costEgp = parseFloat(row['cost_per_unit_egp'] || row['cost_per_unit'] || row['سعر_التكلفة'] || row['التكلفة'] || '0') || 0;
        const costMinor = Math.round(costEgp * 100);
        const currentStock = parseFloat(row['current_stock'] || row['الرصيد_الحالي'] || row['الرصيد'] || '0') || 0;
        const currentStockMicro = Math.round(currentStock * 1000000);

        const existing = await getQuery(`SELECT id FROM inventory_items WHERE name = ? LIMIT 1`, [name]);
        if (existing) {
          await runQuery(
            `UPDATE inventory_items 
             SET category = ?, unit = ?, min_limit = ?, cost_per_unit_minor = ?, current_stock_microunits = ?, updated_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [category, unit, minLimit, costMinor, currentStockMicro, existing.id]
          );
        } else {
          await runQuery(
            `INSERT INTO inventory_items (name, category, unit, min_limit, cost_per_unit_minor, current_stock_microunits, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [name, category, unit, minLimit, costMinor, currentStockMicro]
          );
        }
        importedIngredientsCount++;
      }
    }

    // 2. Ingest Menu Items SECOND
    if (menuFile) {
      const menuRows = await parseCsvBuffer(menuFile.buffer);
      const categoryCache = new Map();
      const existingCats = await allQuery(`SELECT id, name FROM menu_categories`);
      for (const c of existingCats) categoryCache.set(c.name.trim().toLowerCase(), c.id);

      for (const row of menuRows) {
        const sku = (row['sku'] || row['كود_الصنف'] || row['الكود'] || '').trim() || null;
        const name = (row['name'] || row['اسم_الصنف'] || row['الاسم'] || row['اسم'] || row['item_name'] || '').trim();
        const nameEn = (row['name_en'] || row['الاسم_الانجليزي'] || '').trim() || null;
        const categoryName = (row['category'] || row['القسم'] || row['التصنيف'] || row['category_name'] || 'مشروبات ساخنة').trim();
        const rawPrice = row['price'] || row['السعر'] || row['سعر'] || row['price_egp'] || '0';
        const description = (row['description'] || row['الوصف'] || row['ملاحظات'] || '').trim();
        const department = (row['department'] || row['محطة_التحضير'] || 'BARISTA').toUpperCase().trim();

        const hasSugar = (row['has_sugar_options'] === '1' || row['has_sugar_options'] === 'true' || row['خيارات_السكر'] === '1') ? 1 : 0;
        const hasRoast = (row['has_roast_options'] === '1' || row['has_roast_options'] === 'true' || row['خيارات_البن'] === '1') ? 1 : 0;
        const isSurprise = (row['is_surprise_mix'] === '1' || row['is_surprise_mix'] === 'true' || row['خلطة_مفاجأة'] === '1') ? 1 : 0;
        const prepInstructions = (row['prep_instructions'] || row['تعليمات_التحضير'] || row['طريقة_التحضير'] || '').trim() || null;
        
        let rawFlavors = row['available_flavors'] || row['النكهات'] || null;
        let flavorsStr = null;
        if (rawFlavors) {
          if (typeof rawFlavors === 'string' && (rawFlavors.startsWith('[') || rawFlavors.includes(','))) {
            if (rawFlavors.startsWith('[')) {
              flavorsStr = rawFlavors;
            } else {
              flavorsStr = JSON.stringify(rawFlavors.split(',').map(s => s.trim()).filter(Boolean));
            }
          } else {
            flavorsStr = JSON.stringify([String(rawFlavors).trim()]);
          }
        }

        if (!name) continue;

        const price = parseFloat(rawPrice) || 0;
        const priceMinor = Math.round(price * 100);

        const catKey = categoryName.toLowerCase();
        let categoryId = categoryCache.get(catKey);
        if (!categoryId) {
          const catInsert = await runQuery(
            `INSERT INTO menu_categories (name, icon, is_active) VALUES (?, '☕', 1)`,
            [categoryName]
          );
          categoryId = catInsert.lastID;
          categoryCache.set(catKey, categoryId);
        }

        const existingItem = await getQuery(`SELECT id FROM menu_items WHERE name = ? LIMIT 1`, [name]);
        let itemId;
        if (existingItem) {
          itemId = existingItem.id;
          await runQuery(
            `UPDATE menu_items 
             SET sku = COALESCE(?, sku), category_id = ?, name_en = COALESCE(?, name_en), description = ?, department = ?, 
                 has_sugar_options = ?, has_roast_options = ?, available_flavors = ?, is_surprise_mix = ?, prep_instructions = ?,
                 is_available = 1, lifecycle_state = 'PUBLISHED', updated_at = datetime('now', 'localtime')
             WHERE id = ?`,
            [sku, categoryId, nameEn, description, department, hasSugar, hasRoast, flavorsStr, isSurprise, prepInstructions, itemId]
          );
        } else {
          const itemInsert = await runQuery(
            `INSERT INTO menu_items (sku, category_id, name, name_en, description, department, has_sugar_options, has_roast_options, available_flavors, is_surprise_mix, prep_instructions, is_available, is_sellable, lifecycle_state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'PUBLISHED')`,
            [sku, categoryId, name, nameEn, description, department, hasSugar, hasRoast, flavorsStr, isSurprise, prepInstructions]
          );
          itemId = itemInsert.lastID;
        }

        await runQuery(
          `INSERT OR REPLACE INTO menu_prices (menu_item_id, amount_minor, currency)
           VALUES (?, ?, 'ج.م')`,
          [itemId, priceMinor]
        );

        importedMenuCount++;
      }
    }

    // 3. Ingest Recipes THIRD -> Bridge Menu Items and BOM Ingredients
    if (recipesFile) {
      const recRows = await parseCsvBuffer(recipesFile.buffer);
      for (const row of recRows) {
        const menuItemName = (row['menu_item_name'] || row['اسم_الصنف'] || row['الصنف'] || '').trim();
        const ingredientName = (row['ingredient_name'] || row['اسم_الخامة'] || row['الخامة'] || '').trim();
        const qty = parseFloat(row['quantity'] || row['الكمية'] || row['الكمية_المطلوبة'] || '0') || 0;
        const unit = (row['unit'] || row['وحدة_القياس'] || row['الوحدة'] || 'وحدة').trim();

        if (!menuItemName || !ingredientName || qty <= 0) continue;

        const menuItem = await getQuery(`SELECT id FROM menu_items WHERE name = ? LIMIT 1`, [menuItemName]);
        const ingredient = await getQuery(`SELECT id FROM inventory_items WHERE name = ? LIMIT 1`, [ingredientName]);

        if (menuItem && ingredient) {
          // 1. Insert into recipes table
          await runQuery(
            `INSERT INTO recipes (menu_item_id, ingredient_id, quantity_required, unit) VALUES (?, ?, ?, ?)`,
            [menuItem.id, ingredient.id, qty, unit]
          );

          // 2. Sync to recipe_versions & recipe_ingredients
          let versionRow = await getQuery(`SELECT id FROM recipe_versions WHERE menu_item_id = ? AND version = 1`, [menuItem.id]);
          let versionId = versionRow ? versionRow.id : null;
          if (!versionId) {
            const vRes = await runQuery(`INSERT INTO recipe_versions (menu_item_id, version) VALUES (?, 1)`, [menuItem.id]);
            versionId = vRes.lastID;
          }

          const qtyMicro = Math.round(qty * 1000000);
          await runQuery(
            `INSERT INTO recipe_ingredients (recipe_version_id, inventory_item_id, quantity_microunits, unit) VALUES (?, ?, ?, ?)`,
            [versionId, ingredient.id, qtyMicro, unit]
          );

          importedRecipesCount++;
        }
      }
    }

    res.json({
      success: true,
      imported_ingredients: importedIngredientsCount,
      imported_menu_items: importedMenuCount,
      imported_recipes: importedRecipesCount,
      message: `تم الاستيراد الشامل بنجاح! (الأصناف: ${importedMenuCount}، الخامات: ${importedIngredientsCount}، الوصفات: ${importedRecipesCount}) 📦✨`
    });
  } catch (err) {
    logger.error('Error in mega bulk import:', err);
    next(err);
  }
});

module.exports = router;
