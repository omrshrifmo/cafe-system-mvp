/**
 * Users Repository
 * Encapsulates all database interactions for User entities.
 */
const { getQuery, allQuery, runQuery } = require('../../db/connection');

class UserRepository {
  async findById(id, tx = null) {
    const query = tx ? tx.get : getQuery;
    return await query(`SELECT * FROM v3_users WHERE id = ?`, [id]);
  }

  async findByPin(pinHash, tx = null) {
    const query = tx ? tx.get : getQuery;
    return await query(`SELECT * FROM v3_users WHERE pin_hash = ? AND is_active = 1`, [pinHash]);
  }

  async findAll(venueId = 'V_DEFAULT', tx = null) {
    const query = tx ? tx.all : allQuery;
    return await query(`SELECT * FROM v3_users WHERE venue_id = ?`, [venueId]);
  }

  async create(user, tx = null) {
    const run = tx ? tx.run : runQuery;
    const { id, venueId, name, pinHash, roleId, hourlyRateMinor } = user;
    await run(
      `INSERT INTO v3_users (id, venue_id, name, pin_hash, role_id, hourly_rate_minor) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, venueId, name, pinHash, roleId, hourlyRateMinor || 0]
    );
    return await this.findById(id, tx);
  }
}

module.exports = new UserRepository();
