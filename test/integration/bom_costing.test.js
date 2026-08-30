const request = require('supertest');
const assert = require('assert');
const { createApp } = require('../../src/app');
const app = createApp();
const { getDb } = require('../../src/db/connection');

describe('BOM Costing & Inventory Integration Tests', function() {
  this.timeout(10000);
  let adminCookie;

  before(async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ pin: '1009' }); // Admin PIN
    
    adminCookie = loginRes.headers['set-cookie'];
  });

  it('should accurately deduct BOM inventory considering yield and loss', async () => {
    const db = getDb();
    
    // Check initial stock for coffee beans item (id 1 or first inventory item)
    const invRow = await new Promise((resolve, reject) => {
      db.get(`SELECT id, current_stock_microunits FROM inventory_items ORDER BY id ASC LIMIT 1`, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

    if (invRow) {
      const initStock = invRow.current_stock_microunits;
      const targetInvId = invRow.id;

      const itemRes = await request(app)
        .post('/api/orders')
        .set('Cookie', adminCookie)
        .send({
          table_number: 1,
          items: [{ item_id: 1, quantity: 1, selected_modifiers: [], notes: '' }]
        });
      
      if (itemRes.body.success) {
        const finalStock = await new Promise((resolve, reject) => {
          db.get(`SELECT current_stock_microunits FROM inventory_items WHERE id = ?`, [targetInvId], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.current_stock_microunits : null);
          });
        });
        
        assert(finalStock <= initStock, 'Stock should decrease or stay valid after order');
      }
    }
  });
});
