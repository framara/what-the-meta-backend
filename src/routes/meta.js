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
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
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
  } else if (dungeon_id && !period_id) {
    // Use per-dungeon view
    params = [season_id, dungeon_id, limit, offset];
    sql = `SELECT * FROM top_keys_per_dungeon WHERE season_id = $1 AND dungeon_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT $3 OFFSET $4;`;
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

// GET /meta/evolution/:season_id
router.get('/spec-evolution/:season_id', async (req, res) => {
  const season_id = Number(req.params.season_id);
  if (!season_id) {
    return res.status(400).json({ error: 'season_id is required' });
  }
  try {
    // Get all periods for the season
    const periodsResult = await db.pool.query(
      'SELECT id FROM period WHERE season_id = $1 ORDER BY id',
      [season_id]
    );
    const periods = periodsResult.rows;
    // For each period, get top keys and aggregate spec popularity
    const evolution = [];
    for (const period of periods) {
      const keysResult = await db.pool.query(
        'SELECT members FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2',
        [season_id, period.id]
      );
      // Aggregate spec counts for this period
      const specCounts = {};
      for (const row of keysResult.rows) {
        for (const m of row.members || []) {
          specCounts[m.spec_id] = (specCounts[m.spec_id] || 0) + 1;
        }
      }
      evolution.push({
        period_id: period.id,
        spec_counts: specCounts
      });
    }
    res.json({ season_id, evolution });
  } catch (err) {
    console.error('[EVOLUTION ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 