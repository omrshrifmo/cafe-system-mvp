const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const multicastDNS = require('multicast-dns');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const { 
  createOrderWithBOM, 
  completeOrder, 
  getPendingOrders, 
  getInventory, 
  getMenu, 
  updateMenuBulk, 
  addMenuItem,
  getOpenTableSessions,
  openTableSession,
  closeTableSession,
  getTableOrders,
  logWaste,
  getPastOrdersToday,
  saveOrderPayments,
  logEmployeeAdvance,
  getTodayAdvances,
  logDailyExpense,
  getTodayExpenses,
  getEodReport,
  getCustomer,
  addOrUpdateCustomer,
  moveTableSession,
  logShareholderTransaction,
  getShareholderLedger,
  getBIData,
  loginWithPin,
  logPurchase,
  getPurchasesHistory,
  clockInUser,
  clockOutUser,
  getActiveShifts,
  getUserShiftStatus,
  getTotalTipsPool,
  voidOrder,
  declareCash,
  getDrawerDeclarations,
  logAudit,
  getAuditLogs,
  updateKdsStatus,
  requestOrderCancellation,
  resolveOrderCancellation,
  updateUserHourlyRate,
  logPenalty,
  getPenalties,
  getPayrollData,
  logComplaint,
  getComplaints,
  resolveComplaint,
  getAllTables,
  createCustomTable,
  updateTableMetadata,
  updateTableLifecycleStatus,
  getTablesByZone,
  seatTable,
  requestTableCheck,
  vacateTable,
  updateTableTimestampsOnOrder,
  updateTableStatusOnCheckout,
  getRecipeDetails,
  transferMaterial,
  getMaterialTransfers,
  getStaffAllowances,
  updateStaffAllowance,
  getStaffRemainingQuota,
  createStaffOrder,
  getBOMVarianceReport,
  getExpectedCashForShift,
  declareCashExtended,
  getSystemConfig,
  updateSystemConfig,
  factoryResetDatabase,
  getUserShiftReport,
  // Existing imports
  getWasteLogs,
  getSuppliers, addSupplier, updateSupplier, deleteSupplier,
  getMenuCategories, addMenuCategory, updateMenuCategory, deleteMenuCategory,
  getMenuItems, addMenuItemNew, updateMenuItem, deleteMenuItem,
  addItemVariant, deleteItemVariant, addItemAddon, deleteItemAddon,
  createOrderSession, getOrderSession, closeOrderSession, getOpenSessionsForTable,
  getReservations, createReservation, updateReservationStatus,
  getAllCustomers, addCustomerFeedback, getCustomerFeedback,
  getProfitabilityReport, getLowStockItems, updateInventorySettings,
  getAllUsers, createUser, updateUser, deleteUser,
  db 
} = require('./database');
const net = require('net');


const upload = multer({ dest: path.join(__dirname, 'uploads/') });

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Helper function to find local non-internal IPv4 address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// mDNS (Multicast DNS) Domain Broadcasting
const mdns = multicastDNS();

mdns.on('query', (query) => {
  const questions = query.questions || [];
  const matchesMazaj = questions.some((q) => q.name === 'mazaj.local' && (q.type === 'A' || q.type === 'ANY'));

  if (matchesMazaj) {
    const localIp = getLocalIpAddress();
    mdns.respond({
      answers: [{
        name: 'mazaj.local',
        type: 'A',
        ttl: 300,
        data: localIp
      }]
    });
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket server
const wss = new WebSocketServer({ server });

/**
 * Broadcast message to all connected WebSocket clients
 * @param {Object} data - Payload object to send
 */
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔌 [WebSocket] Client connected from ${clientIp} (Total clients: ${wss.clients.size})`);

  ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Connected to Cafe POS/KDS WebSocket Server' }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'RUNNER_BUSY' || data.type === 'RUNNER_DELIVERED') {
        broadcast(data);
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e.message);
    }
  });

  ws.on('close', () => {
    console.log(`❌ [WebSocket] Client disconnected (Total clients: ${wss.clients.size})`);
  });

  ws.on('error', (err) => {
    console.error(`⚠️ [WebSocket] Client error:`, err.message);
  });
});

// API Routes

/**
 * POST /api/auth/login
 * Role-Based Access Control PIN Authentication
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { pin_code } = req.body;
    if (!pin_code) {
      return res.status(400).json({ success: false, error: 'رمز PIN مطلوب' });
    }
    const user = await loginWithPin(pin_code);
    if (!user) {
      return res.status(401).json({ success: false, error: 'رمز PIN غير صحيح' });
    }

    const roleRoutes = {
      BARISTA: [
        { name: 'شاشة البارستا (Barista KDS)', url: 'kds.html', icon: '☕' }
      ],
      SHIASH: [
        { name: 'شاشة الشيشة (Shisha KDS)', url: 'shisha.html', icon: '💨' }
      ],
      CHEF: [
        { name: 'شاشة المطبخ (Kitchen KDS)', url: 'kitchen.html', icon: '🍳' }
      ],
      WAITER: [
        { name: 'نقطة البيع والصالة', url: 'pos.html', icon: '💳' },
        { name: 'شاشة استلام الطلبات (Runner)', url: 'runner.html', icon: '🏃' }
      ],
      HALL_MANAGER: [
        { name: 'نقطة البيع والصالة', url: 'pos.html', icon: '💳' },
        { name: 'شاشة استلام الطلبات (Runner)', url: 'runner.html', icon: '🏃' }
      ],
      OP_ASSISTANT_CASHIER: [
        { name: 'نقطة البيع والدفع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'تقفيل الدرج (الإقرار الأعمى)', url: 'hr.html', icon: '🔒' }
      ],
      CASHIER: [
        { name: 'نقطة البيع والدفع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'تقفيل الدرج (الإقرار الأعمى)', url: 'hr.html', icon: '🔒' }
      ],
      OP_MANAGER: [
        { name: 'نقطة البيع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'مؤشرات الأداء (BI Dashboard)', url: 'bi.html', icon: '📊' },
        { name: 'التقرير المالي اليومي (EOD)', url: 'eod.html', icon: '📜' },
        { name: 'مشتريات المخزون', url: 'purchasing.html', icon: '🛒' },
        { name: 'إدارة الموارد البشرية والرواتب', url: 'hr.html', icon: '👥' },
        { name: 'إدارة الجودة والشكاوى', url: 'qa.html', icon: '🛡️' },
        { name: 'مخزون الخامات (BOM)', url: 'inventory.html', icon: '📦' },
        { name: 'مدير القائمة الكامل', url: 'menu-manager.html', icon: '🍽️' },
        { name: 'إدارة العملاء (CRM)', url: 'crm.html', icon: '👥' },
        { name: 'إدارة الموردين', url: 'suppliers.html', icon: '🚚' },
        { name: 'الحجوزات', url: 'reservations.html', icon: '📅' }
      ],
      MANAGER: [
        { name: 'نقطة البيع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'مؤشرات الأداء (BI Dashboard)', url: 'bi.html', icon: '📊' },
        { name: 'التقرير المالي اليومي (EOD)', url: 'eod.html', icon: '📜' },
        { name: 'مشتريات المخزون', url: 'purchasing.html', icon: '🛒' },
        { name: 'إدارة الموارد البشرية والرواتب', url: 'hr.html', icon: '👥' },
        { name: 'إدارة الجودة والشكاوى', url: 'qa.html', icon: '🛡️' },
        { name: 'مخزون الخامات (BOM)', url: 'inventory.html', icon: '📦' },
        { name: 'مدير القائمة الكامل', url: 'menu-manager.html', icon: '🍽️' },
        { name: 'إدارة العملاء (CRM)', url: 'crm.html', icon: '👥' },
        { name: 'إدارة الموردين', url: 'suppliers.html', icon: '🚚' },
        { name: 'الحجوزات', url: 'reservations.html', icon: '📅' }
      ],
      OWNER: [
        { name: 'نقطة البيع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'مؤشرات الأداء (BI Dashboard)', url: 'bi.html', icon: '📊' },
        { name: 'التقرير المالي اليومي (EOD)', url: 'eod.html', icon: '📜' },
        { name: 'مشتريات المخزون', url: 'purchasing.html', icon: '🛒' },
        { name: 'إدارة الموارد البشرية والرواتب', url: 'hr.html', icon: '👥' },
        { name: 'إدارة الجودة والشكاوى', url: 'qa.html', icon: '🛡️' },
        { name: 'مخزون الخامات (BOM)', url: 'inventory.html', icon: '📦' },
        { name: 'مدير القائمة الكامل', url: 'menu-manager.html', icon: '🍽️' },
        { name: 'حسابات الشركاء', url: 'shareholders.html', icon: '🏛️' },
        { name: 'إدارة العملاء (CRM)', url: 'crm.html', icon: '👥' },
        { name: 'إدارة الموردين', url: 'suppliers.html', icon: '🚚' },
        { name: 'الحجوزات', url: 'reservations.html', icon: '📅' },
        { name: 'شاشة البارستا', url: 'kds.html', icon: '☕' },
        { name: 'شاشة الشيشة', url: 'shisha.html', icon: '💨' },
        { name: 'شاشة المطبخ', url: 'kitchen.html', icon: '🍳' },
        { name: 'شاشة الصالة (Runner)', url: 'runner.html', icon: '🏃' }
      ],
      ADMIN: [
        { name: 'نقطة البيع (POS)', url: 'pos.html', icon: '💳' },
        { name: 'مؤشرات الأداء (BI Dashboard)', url: 'bi.html', icon: '📊' },
        { name: 'التقرير المالي اليومي (EOD)', url: 'eod.html', icon: '📜' },
        { name: 'مشتريات المخزون', url: 'purchasing.html', icon: '🛒' },
        { name: 'إدارة الموارد البشرية والرواتب', url: 'hr.html', icon: '👥' },
        { name: 'إدارة الجودة والشكاوى', url: 'qa.html', icon: '🛡️' },
        { name: 'مخزون الخامات (BOM)', url: 'inventory.html', icon: '📦' },
        { name: 'مدير القائمة الكامل', url: 'menu-manager.html', icon: '🍽️' },
        { name: 'حسابات الشركاء', url: 'shareholders.html', icon: '🏛️' },
        { name: 'إدارة العملاء (CRM)', url: 'crm.html', icon: '👥' },
        { name: 'إدارة الموردين', url: 'suppliers.html', icon: '🚚' },
        { name: 'الحجوزات', url: 'reservations.html', icon: '📅' },
        { name: 'شاشة البارستا', url: 'kds.html', icon: '☕' },
        { name: 'شاشة الشيشة', url: 'shisha.html', icon: '💨' },
        { name: 'شاشة المطبخ', url: 'kitchen.html', icon: '🍳' },
        { name: 'شاشة الصالة (Runner)', url: 'runner.html', icon: '🏃' }
      ]
    };

    const tools = roleRoutes[user.role] || roleRoutes.CASHIER;
    const activeShift = await getUserShiftStatus(user.id);

    console.log(`🔐 [LOGIN SUCCESS] User: ${user.name} (${user.role})`);
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role
      },
      tools,
      activeShift
    });
  } catch (err) {
    console.error('Error in login endpoint:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Purchasing API Routes
 */
app.post('/api/purchases', async (req, res) => {
  try {
    const { inventory_id, qty_added, total_cost } = req.body;
    if (!inventory_id || !qty_added) {
      return res.status(400).json({ success: false, error: 'بيانات الشراء غير مكتملة' });
    }
    const purchase = await logPurchase(inventory_id, qty_added, total_cost || 0);
    console.log(`🛒 [PURCHASE LOGGED] Inv #${inventory_id} +${qty_added} (Cost: ${total_cost} EGP)`);
    broadcast({ type: 'PURCHASE_LOGGED', purchase });
    res.status(201).json({ success: true, purchase });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/purchases', async (req, res) => {
  try {
    const purchases = await getPurchasesHistory();
    res.json({ success: true, purchases });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Shift Management API Routes
 */
app.post('/api/orders/complete', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'ID الطلب مطلوب' });
    const order = await completeOrder(id);
    if (!order) return res.status(404).json({ success: false, error: 'الطلب غير موجود' });
    broadcast({ type: 'ORDER_COMPLETED', order });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Void / Refund Order Endpoint (Manager PIN protected)
 */
app.post('/api/orders/void', async (req, res) => {
  try {
    const { order_id, manager_pin } = req.body;
    if (!order_id || !manager_pin) {
      return res.status(400).json({ success: false, error: 'رقم الطلب ورمز PIN للمدير مطلوبان' });
    }

    const result = await voidOrder(order_id, manager_pin);
    if (!result.success) {
      return res.status(400).json(result);
    }

    broadcast({ type: 'ORDER_VOIDED', order: result.voided_order });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});



app.post('/api/shifts/clock-in', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'معرف الموظف مطلوب' });
    }
    const shift = await clockInUser(user_id);
    console.log(`⏰ [CLOCK IN] User #${user_id} (${shift.user_name})`);
    broadcast({ type: 'SHIFT_UPDATED', shift });
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/shifts/clock-out', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: 'معرف الموظف مطلوب' });
    }
    const result = await clockOutUser(user_id);
    console.log(`⏱️ [CLOCK OUT] User #${user_id}`);
    broadcast({ type: 'SHIFT_UPDATED', result });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/shifts/active', async (req, res) => {
  try {
    const activeShifts = await getActiveShifts();
    res.json({ success: true, shifts: activeShifts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/shifts/user/:userId', async (req, res) => {
  try {
    const shift = await getUserShiftStatus(req.params.userId);
    res.json({ success: true, shift });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/menu
 */
app.get('/api/menu', async (req, res) => {
  try {
    const menu = await getMenu();
    res.json({ success: true, menu });
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/menu/bulk
 */
app.post('/api/menu/bulk', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'قائمة العناصر مفقودة (items array is required)' });
    }
    await updateMenuBulk(items);
    console.log(`📝 [MENU UPDATED] Bulk update completed for ${items.length} items.`);
    res.json({ success: true, message: 'تم تحديث قائمة المشروبات والمأكولات بنجاح' });
  } catch (err) {
    console.error('Error bulk updating menu:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/menu/add
 */
app.post('/api/menu/add', async (req, res) => {
  try {
    const { menu_item_name, price, category } = req.body;
    if (!menu_item_name || typeof menu_item_name !== 'string' || !menu_item_name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم الصنف مطلوب (menu_item_name is required)' });
    }

    const newItem = await addMenuItem(menu_item_name.trim(), price, category);
    console.log(`➕ [MENU ITEM ADDED] ${newItem.menu_item_name} - ${newItem.price} EGP (${newItem.category})`);
    res.status(201).json({ success: true, item: newItem });
  } catch (err) {
    console.error('Error adding menu item:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/menu/upload
 * CSV Upload via Multer & CSV Parser
 * Format: Name, Category, Price, Recipe_Item, Recipe_Qty
 */
app.post('/api/menu/upload', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'يرجى إرفاق ملف CSV' });
  }

  const results = [];
  const filePath = req.file.path;

  fs.createReadStream(filePath)
    .pipe(csvParser())
    .on('data', (data) => {
      const name = data.Name || data.name || data.menu_item_name || data['اسم الصنف'];
      const category = (data.Category || data.category || data['القسم'] || 'BARISTA').toUpperCase();
      const price = Number(data.Price || data.price || data['السعر']) || 0;
      if (name && name.trim()) {
        results.push({
          menu_item_name: name.trim(),
          category,
          price
        });
      }
    })
    .on('end', async () => {
      try {
        if (results.length > 0) {
          // Insert items into recipes
          for (const item of results) {
            await addMenuItem(item.menu_item_name, item.price, item.category);
          }
          await updateMenuBulk(results);
        }
        fs.unlinkSync(filePath); // Clean temp file
        res.json({ success: true, count: results.length, message: `تم رفع وتحديث ${results.length} صنف بنجاح` });
      } catch (err) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ success: false, error: err.message });
      }
    })
    .on('error', (err) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.status(500).json({ success: false, error: err.message });
    });
});

/**
 * Dynamic Table Lifecycle & Zone Endpoints
 */
app.get('/api/tables', async (req, res) => {
  try {
    const { zone } = req.query;
    const tables = zone ? await getTablesByZone(zone) : await getAllTables();
    res.json({ success: true, tables });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables', async (req, res) => {
  try {
    const { table_number, custom_name, zone, capacity, customer_name, customer_phone, customer_id } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const result = await createCustomTable(table_number, custom_name, zone, capacity, customer_name, customer_phone, customer_id);
    broadcast({ type: 'TABLE_CREATED_OR_UPDATED', table: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/tables/:table_number/metadata', async (req, res) => {
  try {
    const result = await updateTableMetadata(req.params.table_number, req.body);
    broadcast({ type: 'TABLE_METADATA_UPDATED', table_number: req.params.table_number, ...req.body });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/tables/:table_number/lifecycle', async (req, res) => {
  try {
    const { status, user_id, waiter_id } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'حالة الطاولة مطلوبة' });
    const result = await updateTableLifecycleStatus(req.params.table_number, status, user_id, waiter_id);
    broadcast({ type: 'TABLE_LIFECYCLE_CHANGED', table_number: req.params.table_number, status, user_id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables/seat', async (req, res) => {
  try {
    const { table_number, custom_name, customer_name, customer_phone } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const result = await seatTable(table_number, custom_name, customer_name, customer_phone);
    broadcast({ type: 'TABLE_SEATED', table_number, custom_name, customer_name });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables/request-check', async (req, res) => {
  try {
    const { table_number } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const result = await requestTableCheck(table_number);
    broadcast({ type: 'TABLE_CHECK_REQUESTED', table_number });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables/vacate', async (req, res) => {
  try {
    const { table_number } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const result = await vacateTable(table_number);
    broadcast({ type: 'TABLE_VACATED', table_number });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables/open', async (req, res) => {
  try {
    const { table_number } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const session = await openTableSession(table_number);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/tables/close', async (req, res) => {
  try {
    const { table_number } = req.body;
    if (!table_number) return res.status(400).json({ success: false, error: 'رقم الطاولة مطلوب' });
    const session = await closeTableSession(table_number);
    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tables/:table_number/orders', async (req, res) => {
  try {
    const orders = await getTableOrders(req.params.table_number);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// RECIPE DETAILS & INGREDIENTS MODAL API
// ============================================================
app.get('/api/recipes/details/:itemName', async (req, res) => {
  try {
    const recipe = await getRecipeDetails(req.params.itemName);
    res.json({ success: true, recipe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// INTER-STATION MATERIAL TRANSFERS (إعارة وتحويل خامات)
// ============================================================
app.post('/api/materials/transfer', async (req, res) => {
  try {
    const { inventory_id, from_department, to_department, quantity, notes, user_id, user_name } = req.body;
    if (!inventory_id || !from_department || !to_department || !quantity) {
      return res.status(400).json({ success: false, error: 'جميع بيانات التحويل مطلوبة' });
    }
    const result = await transferMaterial(inventory_id, from_department, to_department, quantity, notes, user_id, user_name);
    broadcast({ type: 'MATERIAL_TRANSFERRED', transfer: result });
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/materials/transfers', async (req, res) => {
  try {
    const transfers = await getMaterialTransfers(parseInt(req.query.limit, 10) || 50);
    res.json({ success: true, transfers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// STAFF ALLOWANCES & STAFF ORDERS
// ============================================================
app.get('/api/staff-allowances', async (req, res) => {
  try {
    const allowances = await getStaffAllowances();
    res.json({ success: true, allowances });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/staff-allowances', async (req, res) => {
  try {
    const { role, daily_drink_quota, daily_meal_quota, monthly_budget } = req.body;
    if (!role) return res.status(400).json({ success: false, error: 'الدور الوظيفي مطلوب' });
    const result = await updateStaffAllowance(role, daily_drink_quota, daily_meal_quota, monthly_budget);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/staff-orders/quota/:userId', async (req, res) => {
  try {
    const quota = await getStaffRemainingQuota(req.params.userId);
    res.json({ success: true, quota });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/staff-orders', async (req, res) => {
  try {
    const { item_name, quantity, staff_user_id, authorizer_user_id, notes, shift_type } = req.body;
    if (!item_name || !staff_user_id) {
      return res.status(400).json({ success: false, error: 'اسم الصنف والموظف مطلوبان' });
    }
    const order = await createStaffOrder(item_name, quantity || 1, staff_user_id, authorizer_user_id, notes, shift_type || 'MORNING');
    broadcast({ type: 'NEW_ORDER', order });
    res.status(201).json({ success: true, order });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ============================================================
// CASH RECONCILIATION & EXTENDED BLIND CLOSE
// ============================================================
app.get('/api/reports/cash-reconciliation', async (req, res) => {
  try {
    const { shift_type, date } = req.query;
    const report = await getExpectedCashForShift(shift_type || 'MORNING', date);
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/drawer/declare-extended', async (req, res) => {
  try {
    const { user_id, user_name, shift_type, declared_amount, actual_cash, opening_float, opening_cash, manager_pin, notes } = req.body;
    const amount = declared_amount !== undefined ? declared_amount : actual_cash;
    const floatVal = opening_float !== undefined ? opening_float : (opening_cash !== undefined ? opening_cash : 500);
    const uid = user_id || 1;

    if (amount === undefined || amount === null) {
      return res.status(400).json({ success: false, error: 'المبلغ الفعلي المقر مطلوب' });
    }
    const result = await declareCashExtended(uid, user_name || 'كاشير الوردية', shift_type || 'MORNING', amount, floatVal, manager_pin, notes);
    
    // Auto-generate and spool Shift Z-Report
    try {
      const zReport = await getUserShiftReport(uid, shift_type || 'MORNING');
      zReport.declared_amount = amount;
      zReport.variance = result.variance;
      printShiftZReport(zReport).catch(e => console.warn('Z-Report print error (non-fatal):', e.message));
    } catch (zErr) {
      console.warn('Could not auto-spool Z-Report:', zErr.message);
    }

    broadcast({ type: 'DRAWER_DECLARED', result });
    res.json({ success: true, declaration: result, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// BOM THEORETICAL vs ACTUAL VARIANCE REPORT
// ============================================================
app.get('/api/reports/bom-reconciliation', async (req, res) => {
  try {
    const report = await getBOMVarianceReport(req.query.period || 'today');
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Waste Logging Endpoint
 */
app.post('/api/waste', async (req, res) => {
  try {
    const { inventory_id, item_name, quantity, reason, department } = req.body;
    if (!inventory_id || !quantity) {
      return res.status(400).json({ success: false, error: 'بيانات الهالك غير مكتملة (inventory_id and quantity are required)' });
    }
    const log = await logWaste(inventory_id, item_name || 'خامة مخزون', quantity, reason || 'هالك قسم', department || 'BARISTA');
    console.log(`⚠️ [WASTE LOGGED] ${log.item_name} - ${log.quantity} (${log.department})`);
    
    // Broadcast waste update to inventory screens
    broadcast({ type: 'WASTE_LOGGED', log });
    res.status(201).json({ success: true, log });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/orders/past
 */
app.get('/api/orders/past', async (req, res) => {
  try {
    const category = req.query.category;
    const orders = await getPastOrdersToday(category);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/inventory
 */
app.get('/api/inventory', async (req, res) => {
  try {
    const inventory = await getInventory();
    res.json({ success: true, inventory });
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/orders (Supports department, status, and exclude_completed filters)
 */
app.get('/api/orders', async (req, res) => {
  try {
    const { department, status, exclude_completed } = req.query;
    let orders = await getPendingOrders();

    if (department && department !== 'ALL') {
      orders = orders.filter(o => o.category === department);
    }
    if (status && status !== 'ALL') {
      orders = orders.filter(o => o.status === status || o.kds_status === status);
    }
    if (exclude_completed === '1' || exclude_completed === 'true') {
      orders = orders.filter(o => o.status !== 'READY' && o.status !== 'COMPLETED' && o.kds_status !== 'DELIVERED' && o.kds_status !== 'READY');
    }

    res.json({ success: true, orders });
  } catch (err) {
    console.error('Error fetching pending orders:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orders
 */
app.post('/api/orders', async (req, res) => {
  try {
    const { 
      item_name, quantity, price, table_number, waiter_id, 
      sugar_level, roast_type, order_type, item_notes, addons, 
      variant, staff_user_id, user_id, user_name, shift_type 
    } = req.body;

    if (!item_name || typeof item_name !== 'string' || !item_name.trim()) {
      return res.status(400).json({ success: false, error: 'اسم الصنف مطلوب (item_name is required)' });
    }

    const qty = parseInt(quantity, 10) || 1;
    const inputPrice = price !== undefined && price !== null ? Number(price) : null;
    const tNum = parseInt(table_number, 10) || 0;

    const extra = {
      order_type: order_type || (tNum > 0 ? 'DINE_IN' : 'TAKEAWAY'),
      item_notes: item_notes || null,
      addons: addons || null,
      variant: variant || null,
      staff_user_id: staff_user_id || null,
      user_id: user_id || null,
      user_name: user_name || null,
      shift_type: shift_type || 'MORNING'
    };

    const newOrder = await createOrderWithBOM(item_name.trim(), qty, inputPrice, tNum, waiter_id, sugar_level, roast_type, extra);

    if (tNum > 0) {
      await updateTableTimestampsOnOrder(tNum);
    }

    console.log(`➕ [NEW ORDER] #${newOrder.id} - ${newOrder.item_name} (x${newOrder.quantity}) [Table #${newOrder.table_number}] Type: ${newOrder.order_type} [By: ${user_name || 'System'}]`);

    broadcast({
      type: 'NEW_ORDER',
      order: newOrder
    });

    return res.status(201).json({ success: true, order: newOrder });
  } catch (err) {
    console.error('Error creating order:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * KDS State Machine & Cancellation Handshake Endpoints
 */
app.post('/api/orders/kds-status', async (req, res) => {
  try {
    const { id, kds_status, user_id } = req.body;
    if (!id || !kds_status) return res.status(400).json({ success: false, error: 'معرف الطلب والحالة جديدان مطلوبان' });
    const order = await updateKdsStatus(id, kds_status, user_id);
    broadcast({ type: 'KDS_STATUS_UPDATED', order });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/request-cancel', async (req, res) => {
  try {
    const { id, waiter_id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'معرف الطلب مطلوب' });
    const result = await requestOrderCancellation(id, waiter_id);
    broadcast({ type: 'CANCEL_REQUESTED', orderId: id, result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/resolve-cancel', async (req, res) => {
  try {
    const { id, approved, user_id } = req.body;
    if (!id || approved === undefined) return res.status(400).json({ success: false, error: 'معرف الطلب والقرار مطلوبان' });
    const result = await resolveOrderCancellation(id, approved, user_id);
    broadcast({ type: 'CANCEL_RESOLVED', orderId: id, result });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/orders/complete
 * Broadcasts ORDER_COMPLETED and PICKUP_ALERT for runner screens
 */
app.post('/api/orders/complete', async (req, res) => {
  try {
    const { id, order_id } = req.body;
    const targetId = id || order_id;

    if (!targetId) {
      return res.status(400).json({ success: false, error: 'معرف الطلب مطلوب (id is required)' });
    }

    const updatedOrder = await completeOrder(targetId);

    if (!updatedOrder) {
      return res.status(404).json({ success: false, error: 'الطلب غير موجود (Order not found)' });
    }

    console.log(`✅ [ORDER COMPLETED] #${updatedOrder.id} - ${updatedOrder.item_name} (Table #${updatedOrder.table_number})`);

    // Broadcast completion to WebSockets
    broadcast({
      type: 'ORDER_COMPLETED',
      orderId: updatedOrder.id,
      order: updatedOrder
    });

    // Broadcast Pickup Alert to Runners
    broadcast({
      type: 'PICKUP_ALERT',
      id: updatedOrder.id,
      item_name: updatedOrder.item_name,
      quantity: updatedOrder.quantity,
      table_number: updatedOrder.table_number || 0,
      category: updatedOrder.category,
      station: updatedOrder.category === 'BARISTA' ? 'البارستا' : (updatedOrder.category === 'SHISHA' ? 'الشيشة' : 'المطبخ')
    });

    return res.json({ success: true, orderId: updatedOrder.id, order: updatedOrder });
  } catch (err) {
    console.error('Error completing order:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/checkout
 * Multi-method payment split, dynamic taxes engine, loyalty points & table closure
 */
app.post('/api/checkout', async (req, res) => {
  try {
    const { order_id, table_number, payments, customer_phone, points_redeemed, tip_amount, cashier_name, items } = req.body;
    const tNum = parseInt(table_number, 10) || 0;
    const redeemed = Math.max(0, parseInt(points_redeemed, 10) || 0);

    // 1. Fetch live system configuration for taxation & currency
    const config = await getSystemConfig();

    // 2. Calculate Subtotal, Service %, VAT %, Discount, and Total
    const paymentsArr = Array.isArray(payments) ? payments : [];
    const totalPaidMethods = paymentsArr.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    
    const subtotal = Number(req.body.subtotal) || (totalPaidMethods > 0 ? totalPaidMethods : 0);
    const serviceRate = config.apply_taxes ? (Number(config.service_percent) || 0) : 0;
    const vatRate = config.apply_taxes ? (Number(config.vat_percent) || 0) : 0;

    const serviceFee = Number(((subtotal * serviceRate) / 100).toFixed(2));
    const taxableBase = subtotal + serviceFee;
    const vatFee = Number(((taxableBase * vatRate) / 100).toFixed(2));
    const discountAmount = Number(req.body.discount_amount) || Number(redeemed) || 0;
    const tipFee = Number(tip_amount) || 0;
    
    const calculatedTotal = Number((taxableBase + vatFee - discountAmount + tipFee).toFixed(2));
    const finalTotal = Number(req.body.total_amount) || calculatedTotal || totalPaidMethods;

    const taxBreakdown = {
      subtotal,
      service_amount: serviceFee,
      vat_amount: vatFee,
      discount_amount: discountAmount,
      total_amount: finalTotal,
      currency: config.currency || 'ج.م'
    };

    // 3. Save payments breakdown with tips and tax details in database
    await saveOrderPayments(order_id || null, tNum, paymentsArr, tipFee, taxBreakdown);

    if (tNum > 0) {
      await updateTableStatusOnCheckout(tNum);
    }

    // 4. Process Loyalty Points if phone is provided
    let customerResult = null;
    if (customer_phone && String(customer_phone).trim().length > 0) {
      const cleanPhone = String(customer_phone).trim();
      // Earn 1 point per 10 currency spent
      const earnedPoints = Math.floor(finalTotal / 10);
      const netPointChange = earnedPoints - redeemed;
      customerResult = await addOrUpdateCustomer(cleanPhone, null, netPointChange, finalTotal);
    }

    console.log(`💳 [CHECKOUT COMPLETE] Table #${tNum} - Subtotal: ${subtotal} | Srv: ${serviceFee} | VAT: ${vatFee} | Total: ${finalTotal} ${config.currency}`);

    // 5. Automatic Receipt Print Spool
    const receiptData = {
      order_id,
      table_number: tNum,
      cashier_name: cashier_name || req.body.user_name || 'الكاشير',
      items: Array.isArray(items) ? items : [],
      payments: paymentsArr,
      subtotal,
      service_amount: serviceFee,
      vat_amount: vatFee,
      discount_amount: discountAmount,
      total_amount: finalTotal,
      tip_amount: tipFee,
      customer: customerResult
    };

    printEscPosReceipt(receiptData, config).catch(e => console.warn('Print error (non-fatal):', e.message));
    
    broadcast({ type: 'TABLE_CLOSED', table_number: tNum });
    res.json({ 
      success: true, 
      message: 'تم إغلاق الحساب وتسجيل الدفع بنجاح', 
      customer: customerResult,
      tax_breakdown: taxBreakdown
    });
  } catch (err) {
    console.error('Error during checkout:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/tips/total
 * Fetch total tips pool today
 */
app.get('/api/tips/total', async (req, res) => {
  try {
    const totalTips = await getTotalTipsPool();
    res.json({ success: true, total_tips: totalTips });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/customers/:phone
 * Fetch customer loyalty points record
 */
app.get('/api/customers/:phone', async (req, res) => {
  try {
    const customer = await getCustomer(req.params.phone);
    res.json({ success: true, customer });
  } catch (err) {
    console.error('Error fetching customer:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/tables/move
 * Transfer an open table session to another table number
 */
app.post('/api/tables/move', async (req, res) => {
  try {
    const { from_table, to_table } = req.body;
    const fromT = parseInt(from_table, 10);
    const toT = parseInt(to_table, 10);

    if (!fromT || !toT) {
      return res.status(400).json({ success: false, error: 'رقم الطاولة الحالي والجديد مطلوبان' });
    }

    const result = await moveTableSession(fromT, toT);
    broadcast({ type: 'TABLE_MOVED', from_table: fromT, to_table: toT });
    res.json({ success: true, message: `تم نقل الطاولة #${fromT} إلى الطاولة #${toT} بنجاح`, result });
  } catch (err) {
    console.error('Error moving table session:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Shareholder & Profit Ledger API Routes
 */
app.get('/api/shareholders', async (req, res) => {
  try {
    const data = await getShareholderLedger();
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('Error fetching shareholder ledger:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/shareholders', async (req, res) => {
  try {
    const { partner_name, amount, type, description } = req.body;
    if (!partner_name || !amount || !type) {
      return res.status(400).json({ success: false, error: 'اسم الشريك، المبلغ، ونوع العملية مطلوبان' });
    }

    const record = await logShareholderTransaction(partner_name, amount, type, description || '');
    res.json({ success: true, record });
  } catch (err) {
    console.error('Error logging shareholder transaction:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * HR Employee Advances API Routes
 */
app.post('/api/hr/advances', async (req, res) => {
  try {
    const { employee_name, amount } = req.body;
    if (!employee_name || !amount) {
      return res.status(400).json({ success: false, error: 'اسم الموظف والمبلغ مطلوبين' });
    }
    const advance = await logEmployeeAdvance(employee_name.trim(), amount);
    console.log(`💵 [HR ADVANCE LOGGED] ${advance.employee_name} - ${advance.amount} EGP`);
    res.status(201).json({ success: true, advance });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hr/advances', async (req, res) => {
  try {
    const advances = await getTodayAdvances();
    res.json({ success: true, advances });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Blind Cash Declaration Endpoints
 */
app.post('/api/hr/declare-cash', async (req, res) => {
  try {
    const { user_id, declared_amount } = req.body;
    if (declared_amount === undefined || declared_amount === null) {
      return res.status(400).json({ success: false, error: 'المبلغ النظري المصرح به مطلوب' });
    }
    const result = await declareCash(user_id, declared_amount);
    broadcast({ type: 'DRAWER_DECLARED', declaration: result });
    res.json({ success: true, declaration: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hr/declarations', async (req, res) => {
  try {
    const declarations = await getDrawerDeclarations();
    res.json({ success: true, declarations });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Daily Cafe Expenses API Routes
 */
app.post('/api/expenses', async (req, res) => {
  try {
    const { description, amount, payment_source } = req.body;
    if (!description || !amount) {
      return res.status(400).json({ success: false, error: 'وصف المصروف والمبلغ مطلوبين' });
    }
    const expense = await logDailyExpense(description.trim(), amount, payment_source || 'DRAWER');
    console.log(`💸 [EXPENSE LOGGED] ${expense.description} - ${expense.amount} EGP (${expense.payment_source})`);
    res.status(201).json({ success: true, expense });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/expenses', async (req, res) => {
  try {
    const expenses = await getTodayExpenses();
    res.json({ success: true, expenses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Universal Audit Logs Endpoint
 * GET /api/audits?limit=100
 */
app.get('/api/audits', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح بدخول سجل التدقيق الفني' });
    }
    const limit = parseInt(req.query.limit, 10) || 100;
    const logs = await getAuditLogs(limit);
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * End-of-Day (EOD) Report API Route (Strict Financial Privacy)
 */
app.get('/api/reports/eod', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح للوظيفة الحالية بالاطلاع على الإيرادات والتقارير المالية الكلية' });
    }
    const report = await getEodReport();
    res.json({ success: true, report });
  } catch (err) {
    console.error('Error generating EOD report:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Business Intelligence (BI) Dashboard API Route (Strict Financial Privacy)
 * GET /api/reports/bi?range=today|week|month
 */
app.get('/api/reports/bi', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح للوظيفة الحالية بالاطلاع على الإيرادات والتقارير المالية الكلية' });
    }
    const range = req.query.range || 'today';
    const data = await getBIData(range);
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching BI report data:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Automated Payroll Engine Endpoints
 * GET /api/hr/payroll?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 */
app.get('/api/hr/payroll', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح بالاطلاع على مسير الرواتب الحساس' });
    }
    const { start_date, end_date } = req.query;
    const payroll = await getPayrollData(start_date, end_date);
    res.json({ success: true, payroll });
  } catch (err) {
    console.error('Error fetching payroll:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hr/hourly-rate', async (req, res) => {
  try {
    const { user_id, hourly_rate } = req.body;
    if (!user_id || hourly_rate === undefined) {
      return res.status(400).json({ success: false, error: 'معرف الموظف وأجر الساعة مطلوبان' });
    }
    const result = await updateUserHourlyRate(user_id, hourly_rate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/hr/penalties', async (req, res) => {
  try {
    const { user_id, amount, reason } = req.body;
    if (!user_id || !amount) {
      return res.status(400).json({ success: false, error: 'الموظف ومبلغ الجزاء مطلوبان' });
    }
    const penalty = await logPenalty(user_id, amount, reason);
    res.status(201).json({ success: true, penalty });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/hr/penalties', async (req, res) => {
  try {
    const userId = req.query.user_id;
    const penalties = await getPenalties(userId);
    res.json({ success: true, penalties });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Quality Assurance & Complaints API Routes
 */
app.post('/api/qa/complaints', async (req, res) => {
  try {
    const { order_id, logged_by_user_id, against_user_id, description, severity } = req.body;
    if (!description) {
      return res.status(400).json({ success: false, error: 'تفاصيل ووصف الشكوى مطلوبة' });
    }
    const complaint = await logComplaint(order_id, logged_by_user_id, against_user_id, description, severity);
    broadcast({ type: 'COMPLAINT_LOGGED', complaint });
    res.status(201).json({ success: true, complaint });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/qa/complaints', async (req, res) => {
  try {
    const complaints = await getComplaints();
    res.json({ success: true, complaints });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/qa/complaints/resolve', async (req, res) => {
  try {
    const { complaint_id, user_id } = req.body;
    if (!complaint_id) {
      return res.status(400).json({ success: false, error: 'معرف الشكوى مطلوب' });
    }
    const result = await resolveComplaint(complaint_id, user_id);
    broadcast({ type: 'COMPLAINT_RESOLVED', complaintId: complaint_id });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// SUPPLIERS API
// ============================================================
app.get('/api/suppliers', async (req, res) => {
  try { res.json({ success: true, suppliers: await getSuppliers() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/suppliers', async (req, res) => {
  try {
    const { name, contact_name, phone, email, address, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم المورد مطلوب' });
    const supplier = await addSupplier(name, contact_name, phone, email, address, notes);
    broadcast({ type: 'SUPPLIER_ADDED', supplier });
    res.status(201).json({ success: true, supplier });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/suppliers/:id', async (req, res) => {
  try {
    const result = await updateSupplier(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  try {
    const result = await deleteSupplier(req.params.id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// MENU CATEGORIES API
// ============================================================
app.get('/api/menu/categories', async (req, res) => {
  try { res.json({ success: true, categories: await getMenuCategories() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/menu/categories', async (req, res) => {
  try {
    const { name, name_en, icon, color, sort_order } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم التصنيف مطلوب' });
    const cat = await addMenuCategory(name, name_en, icon, color, sort_order);
    res.status(201).json({ success: true, category: cat });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/menu/categories/:id', async (req, res) => {
  try {
    const result = await updateMenuCategory(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/menu/categories/:id', async (req, res) => {
  try {
    const result = await deleteMenuCategory(req.params.id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// MENU ITEMS (new structured) API
// ============================================================
app.get('/api/menu/items', async (req, res) => {
  try {
    const items = await getMenuItems(req.query.category_id || null);
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/menu/items', async (req, res) => {
  try {
    const { category_id, name, name_en, description, base_price, department, is_available, is_featured, sort_order } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم الصنف مطلوب' });
    const item = await addMenuItemNew(category_id, name, name_en, description, base_price, department, is_available, is_featured, sort_order);
    res.status(201).json({ success: true, item });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/menu/items/:id', async (req, res) => {
  try {
    const result = await updateMenuItem(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/menu/items/:id', async (req, res) => {
  try {
    const result = await deleteMenuItem(req.params.id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Variants
app.post('/api/menu/items/:id/variants', async (req, res) => {
  try {
    const { name, price_delta } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم المتغير مطلوب' });
    const variant = await addItemVariant(req.params.id, name, price_delta || 0);
    res.status(201).json({ success: true, variant });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/menu/variants/:id', async (req, res) => {
  try { res.json({ success: true, result: await deleteItemVariant(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Addons
app.post('/api/menu/items/:id/addons', async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'اسم الإضافة مطلوب' });
    const addon = await addItemAddon(req.params.id, name, price || 0);
    res.status(201).json({ success: true, addon });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/menu/addons/:id', async (req, res) => {
  try { res.json({ success: true, result: await deleteItemAddon(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// ORDER SESSIONS API
// ============================================================
app.post('/api/sessions', async (req, res) => {
  try {
    const { order_type, table_number, customer_phone, notes, created_by, delivery_address, delivery_fee } = req.body;
    const session = await createOrderSession(order_type, table_number, customer_phone, notes, created_by, delivery_address, delivery_fee);
    broadcast({ type: 'SESSION_CREATED', session });
    res.status(201).json({ success: true, session });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await getOrderSession(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'الجلسة غير موجودة' });
    res.json({ success: true, session });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/sessions/:id/close', async (req, res) => {
  try {
    const result = await closeOrderSession(req.params.id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tables/:table_number/sessions', async (req, res) => {
  try {
    const sessions = await getOpenSessionsForTable(req.params.table_number);
    res.json({ success: true, sessions });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// RESERVATIONS API
// ============================================================
app.get('/api/reservations', async (req, res) => {
  try {
    const reservations = await getReservations(req.query.date || null);
    res.json({ success: true, reservations });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/reservations', async (req, res) => {
  try {
    const { customer_name, customer_phone, table_number, party_size, reserved_at, duration_minutes, notes } = req.body;
    if (!customer_name || !reserved_at) return res.status(400).json({ success: false, error: 'اسم العميل وموعد الحجز مطلوبان' });
    const reservation = await createReservation(customer_name, customer_phone, table_number, party_size, reserved_at, duration_minutes, notes);
    broadcast({ type: 'RESERVATION_CREATED', reservation });
    res.status(201).json({ success: true, reservation });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/reservations/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'الحالة مطلوبة' });
    const result = await updateReservationStatus(req.params.id, status);
    broadcast({ type: 'RESERVATION_UPDATED', id: req.params.id, status });
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// CUSTOMER CRM API
// ============================================================
app.get('/api/customers', async (req, res) => {
  try {
    const customers = await getAllCustomers(req.query.search || null);
    res.json({ success: true, customers });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/crm/customers', async (req, res) => {
  try {
    const customers = await getAllCustomers(req.query.search || null);
    res.json({ success: true, customers });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/customers/feedback', async (req, res) => {
  try {
    const { customer_phone, session_id, rating, comment, category } = req.body;
    const fb = await addCustomerFeedback(customer_phone, session_id, rating, comment, category);
    res.status(201).json({ success: true, feedback: fb });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/customers/feedback', async (req, res) => {
  try {
    const feedback = await getCustomerFeedback(req.query.phone || null);
    res.json({ success: true, feedback });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// PROFITABILITY & LOW-STOCK REPORTS
// ============================================================
app.get('/api/reports/profitability', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح' });
    }
    const data = await getProfitabilityReport(req.query.range || 'today');
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/reports/low-stock', async (req, res) => {
  try {
    const items = await getLowStockItems();
    res.json({ success: true, items });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/inventory/:id/settings', async (req, res) => {
  try {
    const { min_stock_level, unit_cost, supplier_id } = req.body;
    const result = await updateInventorySettings(req.params.id, min_stock_level, unit_cost, supplier_id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// USER MANAGEMENT API
// ============================================================
app.get('/api/users', async (req, res) => {
  try {
    const role = req.headers['x-user-role'] || req.query.role;
    if (role && !['OWNER', 'OP_MANAGER', 'ADMIN', 'MANAGER'].includes(String(role).toUpperCase())) {
      return res.status(403).json({ success: false, error: 'غير مصرح' });
    }
    const users = await getAllUsers();
    res.json({ success: true, users });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, role, pin_code, hourly_rate } = req.body;
    if (!name || !role || !pin_code) return res.status(400).json({ success: false, error: 'الاسم والصلاحية ورمز PIN مطلوبان' });
    const user = await createUser(name, role, pin_code, hourly_rate);
    res.status(201).json({ success: true, user });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const result = await updateUser(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const result = await deleteUser(req.params.id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// QR MENU PUBLIC ENDPOINT (no auth required)
// ============================================================
app.get('/api/public/menu', async (req, res) => {
  try {
    // Return menu items grouped by category for public display
    const categories = await getMenuCategories();
    const items = await getMenuItems();
    const grouped = categories
      .filter(c => c.is_active)
      .map(cat => ({
        ...cat,
        items: items.filter(i => i.category_id === cat.id && i.is_available)
      }));
    // Also include legacy items (from recipes) not yet in menu_items
    const legacyMenu = await getMenu();
    res.json({ success: true, grouped, legacy_menu: legacyMenu });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// QR self-order endpoint (no auth, places order directly)
app.post('/api/public/order', async (req, res) => {
  try {
    const { item_name, quantity, price, table_number, sugar_level, roast_type, item_notes, addons, variant } = req.body;
    if (!item_name) return res.status(400).json({ success: false, error: 'اسم الصنف مطلوب' });
    const qty = parseInt(quantity, 10) || 1;
    const tNum = parseInt(table_number, 10) || 0;
    const newOrder = await createOrderWithBOM(item_name.trim(), qty, price || null, tNum, null, sugar_level, roast_type);
    if (tNum > 0) await updateTableTimestampsOnOrder(tNum);
    console.log(`📱 [QR ORDER] #${newOrder.id} - ${newOrder.item_name} (x${qty}) [Table #${tNum}]`);
    broadcast({ type: 'NEW_ORDER', order: { ...newOrder, order_source: 'QR', item_notes, addons, variant } });
    res.status(201).json({ success: true, order: newOrder });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Alias & Helper Endpoints for Dashboard / Integrations
app.get('/api/tables/status', async (req, res) => {
  try {
    const tables = await getAllTables();
    res.json({ success: true, tables });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/purchases/history', async (req, res) => {
  try {
    const purchases = await getPurchasesHistory();
    res.json({ success: true, purchases });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/waste', async (req, res) => {
  try {
    const waste = await getWasteLogs();
    res.json({ success: true, waste });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/sales/summary', async (req, res) => {
  try {
    const bi = await getBIData('today');
    res.json({ 
      success: true, 
      today_revenue: bi.kpis?.total_revenue || 0,
      today_orders: bi.kpis?.total_orders || 0,
      total_revenue: bi.kpis?.total_revenue || 0
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/bi/summary', async (req, res) => {
  try {
    const bi = await getBIData('today');
    res.json({ success: true, data: bi });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ============================================================
// ESC/POS HARDWARE PRINT BRIDGE & RECEIPT GENERATOR
// ============================================================

function sendRawToPrinter(ip, port, dataBuffer) {
  return new Promise((resolve) => {
    if (!ip || ip === '127.0.0.1' || ip === '0.0.0.0') {
      console.log('🖨️ [PRINTER SPOOL - SIMULATED LOCAL]:\n' + dataBuffer.toString());
      return resolve({ success: true, simulated: true });
    }

    const socket = new net.Socket();
    let isHandled = false;
    socket.setTimeout(1500);

    socket.connect(port || 9100, ip, () => {
      socket.write(dataBuffer, () => {
        socket.end();
        if (!isHandled) {
          isHandled = true;
          console.log(`🖨️ [PRINT SUCCESS] Sent job to ${ip}:${port || 9100}`);
          resolve({ success: true, printed: true });
        }
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      if (!isHandled) {
        isHandled = true;
        console.warn(`⚠️ [PRINTER TIMEOUT] Printer at ${ip}:${port || 9100} timed out. Spooled to log.`);
        resolve({ success: true, simulated: true, warning: 'Printer connection timeout' });
      }
    });

    socket.on('error', (err) => {
      socket.destroy();
      if (!isHandled) {
        isHandled = true;
        console.warn(`⚠️ [PRINTER ERROR] Could not connect to ${ip}:${port || 9100} (${err.message}). Spooled to log.`);
        resolve({ success: true, simulated: true, warning: err.message });
      }
    });
  });
}

function buildReceiptText(data, config) {
  const currency = config.currency || 'ج.م';
  const cafeName = config.cafe_name || 'كافيه مزاج';
  const subtotal = Number(data.subtotal) || 0;
  const service = Number(data.service_amount) || 0;
  const vat = Number(data.vat_amount) || 0;
  const discount = Number(data.discount_amount) || 0;
  const tip = Number(data.tip_amount) || 0;
  const total = Number(data.total_amount) || (subtotal + service + vat - discount + tip);

  let text = `
========================================
             ${cafeName}
========================================
رقم الفاتورة: #${data.order_id || '---'}
رقم الطاولة : ${data.table_number ? 'طاولة ' + data.table_number : 'طلب خارجي / تيك أواي'}
الكاشير     : ${data.cashier_name || 'كاشير الوردية'}
التاريخ     : ${new Date().toLocaleString('ar-EG')}
----------------------------------------
الصنف                 الكمية      السعر
----------------------------------------\n`;

  if (Array.isArray(data.items) && data.items.length > 0) {
    data.items.forEach(it => {
      const name = String(it.item_name || it.name || '').padEnd(20, ' ');
      const qty = String(it.quantity || 1).padStart(3, ' ');
      const price = (Number(it.price) * Number(it.quantity || 1)).toFixed(2).padStart(8, ' ');
      text += `${name} ${qty} ${price} ${currency}\n`;
      if (it.sugar_level || it.roast_type || it.addons) {
        text += `  * ${[it.sugar_level, it.roast_type, it.addons].filter(Boolean).join(' - ')}\n`;
      }
    });
  } else {
    text += `قيمة الحساب الكلي                 ${subtotal.toFixed(2)} ${currency}\n`;
  }

  text += `----------------------------------------\n`;
  text += `المجموع الفرعي  : ${subtotal.toFixed(2)} ${currency}\n`;
  if (config.apply_taxes) {
    if (service > 0) text += `خدمة (${config.service_percent}%): ${service.toFixed(2)} ${currency}\n`;
    if (vat > 0) text += `ض.ق.م (${config.vat_percent}%): ${vat.toFixed(2)} ${currency}\n`;
  }
  if (discount > 0) text += `خصم نقاط / ترويجي: -${discount.toFixed(2)} ${currency}\n`;
  if (tip > 0) text += `الإكرامية (Tip) : +${tip.toFixed(2)} ${currency}\n`;
  text += `========================================\n`;
  text += `الإجمالي النهائي : ${total.toFixed(2)} ${currency}\n`;
  text += `========================================\n`;

  if (Array.isArray(data.payments) && data.payments.length > 0) {
    text += `طرق الدفع:\n`;
    data.payments.forEach(p => {
      text += ` - ${p.method || 'CASH'}: ${Number(p.amount || 0).toFixed(2)} ${currency}\n`;
    });
  }

  if (data.customer) {
    text += `----------------------------------------\n`;
    text += `العميل: ${data.customer.phone} | رصيد النقاط: ${data.customer.points || 0} نقطة\n`;
  }

  text += `\n${config.footer_note || 'شكراً لزيارتكم - نتمنى لكم يوماً سعيداً'}\n\n\n`;
  return text;
}

function buildKitchenTicketText(data) {
  let text = `
========================================
          تذكرة تحضير المطبخ/البار
========================================
رقم الطلب : #${data.order_id || '---'}
الموقع    : ${data.table_number ? 'طاولة ' + data.table_number : 'تيك أواي / دليفري'}
القسم     : ${data.department || 'التحضير'}
الوقت     : ${new Date().toLocaleTimeString('ar-EG')}
----------------------------------------\n`;

  if (Array.isArray(data.items) && data.items.length > 0) {
    data.items.forEach(it => {
      text += `[${it.quantity || 1}x] ${it.item_name || it.name}\n`;
      if (it.sugar_level || it.roast_type || it.variant || it.addons || it.item_notes) {
        const details = [it.sugar_level, it.roast_type, it.variant, it.addons, it.item_notes].filter(Boolean).join(' | ');
        text += `   >> ملاحظات: ${details}\n`;
      }
    });
  } else if (data.item_name) {
    text += `[${data.quantity || 1}x] ${data.item_name}\n`;
    if (data.sugar_level || data.roast_type || data.variant || data.addons || data.item_notes) {
      const details = [data.sugar_level, data.roast_type, data.variant, data.addons, data.item_notes].filter(Boolean).join(' | ');
      text += `   >> ملاحظات: ${details}\n`;
    }
  }

  text += `----------------------------------------\n\n\n`;
  return text;
}

function buildZReportText(zData, config) {
  const currency = config.currency || 'ج.م';
  return `
========================================
       تقرير إغلاق الوردية (Z-REPORT)
            ${config.cafe_name || 'كافيه مزاج'}
========================================
الموظف    : ${zData.user_name || '---'} (ID: ${zData.user_id || '---'})
الوردية   : ${zData.shift_type === 'MORNING' ? 'وردية صباحية ☀️' : 'وردية مسائية 🌙'}
بداية العمل: ${zData.clock_in || '---'}
وقت الإغلاق: ${zData.clock_out || new Date().toLocaleString('ar-EG')}
----------------------------------------
رصيد بداية الدرج (Float) : ${Number(zData.opening_float || 0).toFixed(2)} ${currency}
مبيعات الكاش (Cash Sales): ${Number(zData.cash_sales || 0).toFixed(2)} ${currency}
مبيعات الديجيتال/الفيزا  : ${Number(zData.digital_sales || 0).toFixed(2)} ${currency}
إجمالي المبيعات (Total)  : ${Number(zData.total_sales || 0).toFixed(2)} ${currency}
عدد الطلبات المنجزة      : ${zData.order_count || 0} طلب
----------------------------------------
سُلف الموظف المسحوبة     : -${Number(zData.cash_advances || 0).toFixed(2)} ${currency}
مصروفات الدرج المسجلة    : -${Number(zData.cash_expenses || 0).toFixed(2)} ${currency}
إجمالي الإكراميات (Tips) : +${Number(zData.total_tips || 0).toFixed(2)} ${currency}
========================================
الكاش المتوقع بالدرج     : ${Number(zData.expected_cash || 0).toFixed(2)} ${currency}
الكاش الفعلي المقر       : ${Number(zData.declared_amount !== undefined ? zData.declared_amount : zData.expected_cash || 0).toFixed(2)} ${currency}
الفارق المالي (Variance) : ${Number(zData.variance || 0).toFixed(2)} ${currency} [${zData.variance === 0 ? 'مطابق ✅' : (zData.variance > 0 ? 'فائض 📈' : 'عجز ⚠️')}]
========================================
تم الاعتماد والإغلاق في ${new Date().toLocaleString('ar-EG')}
\n\n\n`;
}

async function printEscPosReceipt(receiptData, config) {
  const cfg = config || await getSystemConfig();
  const rawText = buildReceiptText(receiptData, cfg);
  
  // ESC/POS Commands: Init + Pulse Drawer + Print Text + Cut Paper
  const initCmd = Buffer.from([0x1B, 0x40]);
  const drawerPulseCmd = cfg.cash_drawer_auto_kick ? Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]) : Buffer.alloc(0);
  const textBuf = Buffer.from(rawText, 'utf8');
  const cutCmd = Buffer.from([0x1D, 0x56, 0x41, 0x10]);
  
  const payload = Buffer.concat([initCmd, drawerPulseCmd, textBuf, cutCmd]);
  return await sendRawToPrinter(cfg.printer_ip, cfg.printer_port, payload);
}

async function printKitchenTicket(ticketData, config) {
  const cfg = config || await getSystemConfig();
  const rawText = buildKitchenTicketText(ticketData);
  
  const initCmd = Buffer.from([0x1B, 0x40]);
  const textBuf = Buffer.from(rawText, 'utf8');
  const cutCmd = Buffer.from([0x1D, 0x56, 0x41, 0x10]);
  
  const payload = Buffer.concat([initCmd, textBuf, cutCmd]);
  return await sendRawToPrinter(cfg.printer_ip, cfg.printer_port, payload);
}

async function printShiftZReport(zReportData, config) {
  const cfg = config || await getSystemConfig();
  const rawText = buildZReportText(zReportData, cfg);
  
  const initCmd = Buffer.from([0x1B, 0x40]);
  const drawerPulseCmd = Buffer.from([0x1B, 0x70, 0x00, 0x19, 0xFA]);
  const textBuf = Buffer.from(rawText, 'utf8');
  const cutCmd = Buffer.from([0x1D, 0x56, 0x41, 0x10]);
  
  const payload = Buffer.concat([initCmd, drawerPulseCmd, textBuf, cutCmd]);
  return await sendRawToPrinter(cfg.printer_ip, cfg.printer_port, payload);
}

// Global Configuration Endpoints
app.get('/api/config', async (req, res) => {
  try {
    const config = await getSystemConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const updated = await updateSystemConfig(req.body);
    broadcast({ type: 'CONFIG_UPDATED', config: updated });
    res.json({ success: true, config: updated, message: 'تم حفظ إعدادات النظام بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hardware Print Endpoints
app.post('/api/print/receipt', async (req, res) => {
  try {
    const config = await getSystemConfig();
    const result = await printEscPosReceipt(req.body, config);
    res.json({ success: true, result, message: 'تم إرسال أمر الطباعة بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/print/kitchen', async (req, res) => {
  try {
    const config = await getSystemConfig();
    const result = await printKitchenTicket(req.body, config);
    res.json({ success: true, result, message: 'تم إرسال أمر تحضير المطبخ بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/print/z-report', async (req, res) => {
  try {
    const config = await getSystemConfig();
    const result = await printShiftZReport(req.body, config);
    res.json({ success: true, result, message: 'تمت طباعة تقرير Z للوردية بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/print/test', async (req, res) => {
  try {
    const config = await getSystemConfig();
    const testData = {
      order_id: 999,
      table_number: 1,
      cashier_name: 'مدير النظام',
      subtotal: 100,
      service_amount: 12,
      vat_amount: 15.68,
      total_amount: 127.68,
      items: [{ item_name: 'قهوة تركي', quantity: 1, price: 50 }, { item_name: 'لاتيه كراميل', quantity: 1, price: 50 }]
    };
    const result = await printEscPosReceipt(testData, config);
    res.json({ success: true, result, message: 'تمت طباعة صفحة الاختبار بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Shift Z-Report Endpoint
app.get('/api/shifts/z-report/:userId', async (req, res) => {
  try {
    const report = await getUserShiftReport(req.params.userId, req.query.shift_type || 'MORNING');
    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Factory Reset Endpoint
app.post('/api/system/factory-reset', async (req, res) => {
  try {
    const { pin_code } = req.body;
    if (!pin_code) return res.status(400).json({ success: false, error: 'رمز PIN مطلوب لتأكيد إعادة ضبط المصنع' });
    const result = await factoryResetDatabase(pin_code);
    broadcast({ type: 'FACTORY_RESET_TRIGGERED' });
    res.json(result);
  } catch (err) {
    res.status(403).json({ success: false, error: err.message });
  }
});

// Global Express Error-Handling Middleware
app.use((err, req, res, next) => {
  console.error('🔥 [GLOBAL ERROR HANDLER]:', err.stack || err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'حدث خطأ داخلي غير متوقع في الخادم',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

// Start Server
server.listen(PORT, HOST, () => {
  const localIp = getLocalIpAddress();
  console.log(`\n==================================================`);
  console.log(`🚀 Cafe Management System Running!`);
  console.log(`🌐 Local Domain: http://mazaj.local:${PORT}`);
  console.log(`📡 Local IP: http://${localIp}:${PORT}`);
  console.log(`📱 Cashier POS UI: http://mazaj.local:${PORT}/pos.html`);
  console.log(`🛠️ Menu Manager UI: http://mazaj.local:${PORT}/admin-menu.html`);
  console.log(`🏃 Runner Pickup UI: http://mazaj.local:${PORT}/runner.html`);
  console.log(`☕ Barista KDS UI: http://mazaj.local:${PORT}/kds.html`);
  console.log(`💨 Shisha KDS UI: http://mazaj.local:${PORT}/shisha.html`);
  console.log(`🍳 Kitchen KDS UI: http://mazaj.local:${PORT}/kitchen.html`);
  console.log(`📦 Inventory UI: http://mazaj.local:${PORT}/inventory.html`);
  console.log(`📋 Menu Manager: http://mazaj.local:${PORT}/menu-manager.html`);
  console.log(`📱 QR Menu: http://mazaj.local:${PORT}/qr-menu.html?table=1`);
  console.log(`👥 CRM: http://mazaj.local:${PORT}/crm.html`);
  console.log(`🚚 Suppliers: http://mazaj.local:${PORT}/suppliers.html`);
  console.log(`==================================================\n`);
});





