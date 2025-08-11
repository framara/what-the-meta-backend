const axios = require('axios');
const { pool } = require('./db');
const { SEASON_DUNGEONS } = require('../config/constants');

async function backfillSeasonDungeonMappings(portOrBaseUrl) {
  try {
    const base = process.env.INTERNAL_API_BASE || (typeof portOrBaseUrl === 'string' && portOrBaseUrl.startsWith('http')
      ? portOrBaseUrl
      : `http://localhost:${portOrBaseUrl || process.env.PORT || 3000}`);

    // 1) Iterate known seasons from DB
    const seasonsRes = await pool.query('SELECT id FROM season ORDER BY id');
    const seasonIds = seasonsRes.rows.map(r => r.id);

    for (const sid of seasonIds) {
      // Skip if already present
      const hasRows = await pool.query('SELECT 1 FROM season_dungeon WHERE season_id = $1 LIMIT 1', [sid]);
      if (hasRows.rowCount > 0) continue;

      // Prefer constants if available
      const fromConstants = SEASON_DUNGEONS[String(sid)] || SEASON_DUNGEONS[sid] || [];
      if (fromConstants.length > 0) {
        const placeholders = fromConstants.map((_, i) => `($1, $${i + 2})`).join(',');
        await pool.query(
          `INSERT INTO season_dungeon (season_id, dungeon_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
          [sid, ...fromConstants]
        );
        console.log(`[BACKFILL] Inserted ${fromConstants.length} season_dungeon rows for season ${sid} from constants`);
        continue;
      }

      // 2) Discover via internal endpoint (US region)
      try {
        await axios.get(`${base}/wow/advanced/mythic-keystone-season/${sid}/dungeons?region=us`, { timeout: 60000 });
        console.log(`[DISCOVERY] Triggered dungeon discovery for season ${sid}`);
      } catch (discErr) {
        console.warn(`[DISCOVERY] Failed to trigger discovery for season ${sid}:`, discErr.message);
      }
    }
  } catch (err) {
    console.warn('[BACKFILL] Season→Dungeon backfill failed:', err.message);
  }
}

module.exports = { backfillSeasonDungeonMappings };


