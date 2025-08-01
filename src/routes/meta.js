const express = require('express');
const db = require('../services/db');
const { SEASON_METADATA, EXPANSION_METADATA } = require('../config/constants');

const router = express.Router();

// Helper function to get spec evolution data for a specific season
async function getSpecEvolutionForSeason(season_id) {
  // Get all periods for the season
  const periodsResult = await db.pool.query(
    'SELECT id FROM period WHERE season_id = $1 ORDER BY id',
    [season_id]
  );
  const periods = periodsResult.rows;
  
  // Get season and expansion metadata
  const seasonMetadata = SEASON_METADATA[season_id];
  let expansionId = null;
  let expansionName = null;
  let seasonName = null;
  
  if (seasonMetadata) {
    seasonName = seasonMetadata.name;
    // Find the expansion that contains this season
    for (const [expId, expansion] of Object.entries(EXPANSION_METADATA)) {
      if (expansion.seasons && expansion.seasons.includes(season_id)) {
        expansionId = parseInt(expId);
        expansionName = expansion.name;
        break;
      }
    }
  }
  
  // For each period, get top keys and aggregate spec popularity
  const evolution = [];
  let weekCounter = 1;
  
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
    
    // Only include periods that have spec data
    if (Object.keys(specCounts).length > 0) {
      const periodLabel = seasonName ? `${seasonName} - Week ${weekCounter}` : null;
      
      evolution.push({
        period_id: period.id,
        week: weekCounter,
        period_label: periodLabel,
        spec_counts: specCounts
      });
      weekCounter++;
    }
  }
  
  // Only return season data if it has non-empty periods
  if (evolution.length > 0) {
    return { 
      season_id, 
      expansion_id: expansionId,
      expansion_name: expansionName,
      season_name: seasonName,
      evolution 
    };
  }
  return null; // Return null for seasons with only empty periods
}

// GET /meta/top-keys
// If only season_id is provided, query the global view (top_100_keys_global)
// If season_id and period_id are provided (no dungeon_id), query the per-period view (top_100_keys_per_period)
// If period_id or dungeon_id is provided, query the per-group view (top_100_keys_per_group)
// Supports: season_id (required), period_id (optional), dungeon_id (optional), limit (default 100, max 500), offset (default 0)
router.get('/top-keys', async (req, res) => {
  console.log(`📊 [META] GET /meta/top-keys - Season: ${req.query.season_id || 'unknown'}, Period: ${req.query.period_id || 'none'}, Dungeon: ${req.query.dungeon_id || 'none'}`);
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

// GET /meta/top-keys-all-seasons
// Aggregates top keys data from all seasons
// Returns data for each season with their top 100 keys
router.get('/top-keys-all-seasons', async (req, res) => {
  console.log(`📊 [META] GET /meta/top-keys-all-seasons`);
  
  try {
    // Get all seasons that have data
    const seasonsResult = await db.pool.query(
      'SELECT DISTINCT season_id FROM period ORDER BY season_id',
      []
    );
    const seasonIds = seasonsResult.rows.map(row => row.season_id);

    if (seasonIds.length === 0) {
      return res.status(404).json({ error: 'No seasons found with data' });
    }
    
    const aggregatedData = [];
    
    // For each season, get top 100 keys
    for (const seasonId of seasonIds) {
      try {
        // Query the global view for each season (top 1000 keys)
        const { rows } = await db.pool.query(
          'SELECT * FROM top_keys_global WHERE season_id = $1 ORDER BY keystone_level DESC, score DESC LIMIT 1000',
          [seasonId]
        );
        
        // Get season metadata
        const seasonMetadata = SEASON_METADATA[seasonId];
        
        // Only include seasons that have data
        if (rows.length > 0) {
          aggregatedData.push({
            season_id: seasonId,
            season_name: seasonMetadata?.name || `Season ${seasonId}`,
            expansion: seasonMetadata?.expansion || 'Unknown',
            patch: seasonMetadata?.patch || 'Unknown',
            keys_count: rows.length,
            data: rows
          });
        }
      } catch (seasonError) {
        console.error(`[TOP KEYS ALL SEASONS ERROR] Error processing season ${seasonId}:`, seasonError);
        // Continue with other seasons even if one fails
      }
    }
    
    // Calculate summary statistics
    const totalSeasons = aggregatedData.length;
    const totalKeys = aggregatedData.reduce((sum, season) => sum + season.keys_count, 0);
    
    res.json({
      total_seasons: totalSeasons,
      total_keys: totalKeys,
      seasons: aggregatedData
    });
    
  } catch (err) {
    console.error('[TOP KEYS ALL SEASONS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /meta/season-data/:season_id
// Retrieves top 1000 keys for each period in a given season
// Returns comprehensive data over time for AI analysis
router.get('/season-data/:season_id', async (req, res) => {
  console.log(`📊 [META] GET /meta/season-data/${req.params.season_id}`);
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

    if (periods.length === 0) {
      return res.status(404).json({ error: 'No periods found for this season' });
    }

    // Get top 1000 keys for each period
    const seasonData = [];
    for (const period of periods) {
      const keysResult = await db.pool.query(
        'SELECT * FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT 1000',
        [season_id, period.id]
      );

      seasonData.push({
        period_id: period.id,
        keys_count: keysResult.rows.length,
        keys: keysResult.rows
      });
    }

    // Calculate summary statistics
    const totalKeys = seasonData.reduce((sum, period) => sum + period.keys_count, 0);
    const totalPeriods = seasonData.length;

    res.json({
      season_id,
      total_periods: totalPeriods,
      total_keys: totalKeys,
      periods: seasonData
    });

  } catch (err) {
    console.error('[SEASON DATA ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /meta/spec-evolution
// Aggregates spec evolution data from all seasons that have data
router.get('/spec-evolution', async (req, res) => {
  console.log(`📊 [META] GET /meta/spec-evolution`);
  try {
    // Get all seasons that have data
    const seasonsResult = await db.pool.query(
      'SELECT DISTINCT season_id FROM period ORDER BY season_id',
      []
    );
    const seasons = seasonsResult.rows;

    if (seasons.length === 0) {
      return res.status(404).json({ error: 'No seasons found with data' });
    }

    // Get spec evolution data for all seasons using the helper function
    const allSeasonsData = [];
    
    for (const season of seasons) {
      const season_id = season.season_id;
      
      // Check if this season has any periods
      const periodsResult = await db.pool.query(
        'SELECT id FROM period WHERE season_id = $1 LIMIT 1',
        [season_id]
      );
      
      if (periodsResult.rows.length === 0) {
        continue; // Skip seasons with no periods
      }

      // Use the helper function to get spec evolution for this season
      const seasonData = await getSpecEvolutionForSeason(season_id);
      
      // Only include seasons that have non-empty periods
      if (seasonData !== null) {
        allSeasonsData.push(seasonData);
      }
    }

    res.json({
      total_seasons: allSeasonsData.length,
      seasons: allSeasonsData
    });

  } catch (err) {
    console.error('[META AGGREGATE ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /meta/spec-evolution/:season_id
router.get('/spec-evolution/:season_id', async (req, res) => {
  console.log(`📊 [META] GET /meta/spec-evolution/${req.params.season_id}`);
  const season_id = Number(req.params.season_id);
  if (!season_id) {
    return res.status(400).json({ error: 'season_id is required' });
  }
  try {
    // Use the helper function to get spec evolution for this season
    const result = await getSpecEvolutionForSeason(season_id);
    
    // If the season has no non-empty periods, return 404
    if (result === null) {
      return res.status(404).json({ error: 'No spec evolution data found for this season' });
    }
    
    res.json(result);
  } catch (err) {
    console.error('[EVOLUTION ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router; 