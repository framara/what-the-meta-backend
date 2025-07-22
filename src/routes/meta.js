const express = require('express');
const db = require('../services/db');

const router = express.Router();

// GET /meta/top-keys
// If only season_id is provided, query the global view (top_100_keys_global)
// If season_id and period_id are provided (no dungeon_id), query the per-period view (top_100_keys_per_period)
// If period_id or dungeon_id is provided, query the per-group view (top_100_keys_per_group)
// Supports: season_id (required), period_id (optional), dungeon_id (optional), limit (default 100, max 500), offset (default 0)
router.get('/top-keys', async (req, res) => {
  const { season_id, period_id, dungeon_id } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  if (!season_id) {
    return res.status(400).json({ error: 'season_id is required' });
  }
  let sql, params, idx;
  if (!period_id && !dungeon_id) {
    // Use global view
    params = [season_id, limit, offset];
    sql = `SELECT * FROM top_keys_global WHERE season_id = $1 ORDER BY keystone_level DESC, score DESC LIMIT $2 OFFSET $3;`;
  } else if (period_id && !dungeon_id) {
    // Use per-period view
    params = [season_id, period_id, limit, offset];
    sql = `SELECT * FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT $3 OFFSET $4;`;
  } else {
    // Use per-group view
    let where = ['season_id = $1'];
    params = [season_id];
    idx = 2;
    if (period_id) { where.push(`period_id = $${idx}`); params.push(period_id); idx++; }
    if (dungeon_id) { where.push(`dungeon_id = $${idx}`); params.push(dungeon_id); idx++; }
    params.push(limit, offset);
    sql = `SELECT * FROM top_keys_per_group WHERE ${where.join(' AND ')} ORDER BY season_id${period_id ? ', period_id' : ''}, dungeon_id, keystone_level DESC, score DESC LIMIT $${idx} OFFSET $${idx+1};`;
  }
  try {
    const { rows } = await db.pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[TOP KEYS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 