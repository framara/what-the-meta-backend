const express = require('express');
const db = require('../services/db');
const { SEASON_METADATA, EXPANSION_METADATA } = require('../config/constants');
const { getSpecEvolutionForSeason, getCompositionDataForSeason } = require('../services/meta-helpers');

const router = express.Router();

/**
 * META ENDPOINTS DOCUMENTATION
 * 
 * This file contains all meta-related endpoints for the WoW Mythic+ API.
 * Below is a comprehensive list of endpoints and their frontend usage:
 * 
 * 1. GET /meta/top-keys
 *    - Purpose: Retrieves top keys with optional filtering by period/dungeon
 *    - Frontend Usage:
 *      * App.tsx (Home page) - Main leaderboard display with SummaryStats and LeaderboardTable
 *      * GroupCompositionPage - For group composition analysis
 *      * CompAllSeasonsPage - Season-by-season streaming (enhanced format)
 *    - Parameters: season_id (required), period_id (optional), dungeon_id (optional), limit, offset
 *    - Returns: Object with season_info (season_id, season_name, expansion, patch), meta (total_runs, limit, offset), and data array
 * 
 * 2. GET /meta/top-keys-all-seasons
 *    - Purpose: Retrieves top keys from all seasons for historical analysis
 *    - Frontend Usage:
 *      * CompAllSeasonsPage - Historical compositions across all seasons
 *    - Parameters: period_id (optional), dungeon_id (optional), limit, offset
 *    - Returns: Object with total_seasons, total_keys, and seasons array
 * 
 * 3. GET /meta/season-data/:season_id
 *    - Purpose: Retrieves comprehensive season data organized by periods for AI analysis
 *    - Frontend Usage:
 *      * AIPredictionsPage - AI-powered predictions and meta analysis
 *      * GroupCompositionPage - Detailed group composition analysis
 *    - Parameters: season_id (path parameter)
 *    - Returns: Object with season_id, total_periods, total_keys, and periods array
 * 
 * 4. GET /meta/spec-evolution
 *    - Purpose: Retrieves spec evolution data across all seasons
 *    - Frontend Usage:
 *      * MetaEvolutionPage - Meta evolution charts and trends
 *    - Parameters: None
 *    - Returns: Array of season evolution data
 * 
 * 5. GET /meta/spec-evolution/:season_id
 *    - Purpose: Retrieves spec evolution data for a specific season
 *    - Frontend Usage:
 *      * AIPredictionsPage - AI analysis with spec evolution data
 *      * MetaEvolutionPage - Meta evolution charts for specific season
 *    - Parameters: season_id (path parameter)
 *    - Returns: Object with season_id, expansion info, and evolution array
 * 
 * OPTIMIZATION NOTES:
 * - All queries have been optimized to only select necessary fields
 * - Removed unused fields: run_guid, region, realm_id, period_id, rn
 * - Kept essential fields: id, keystone_level, score, rank, dungeon_id, duration_ms, completed_at, members
 * - character_name removed from members JSON for endpoints that don't need it:
 *   * /meta/top-keys-all-seasons (CompAllSeasonsPage)
 *   * /meta/spec-evolution (MetaEvolutionPage)
 *   * /meta/spec-evolution/:season_id (AIPredictionsPage, MetaEvolutionPage)
 * - character_name kept for endpoints that need it:
 *   * /meta/top-keys (LeaderboardTable tooltips)
 * - character_name removed from endpoints that don't need it:
 *   * /meta/top-keys-all-seasons (CompAllSeasonsPage)
 *   * /meta/composition-data/:season_id (GroupCompositionPage, AIPredictionsPage - optimized endpoint)
 *   * /meta/spec-evolution (MetaEvolutionPage)
 *   * /meta/spec-evolution/:season_id (AIPredictionsPage, MetaEvolutionPage)
 * - /meta/season-data/:season_id endpoint has been removed (no longer used)
 */

// GET /meta/top-keys
// Purpose: Retrieves top keys with optional filtering by period/dungeon
// Frontend Usage: 
//   - App.tsx (Home page) - Main leaderboard display with SummaryStats and LeaderboardTable
//   - GroupCompositionPage - For group composition analysis
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
    sql = `SELECT id, keystone_level, score, rank, dungeon_id, duration_ms, completed_at, members FROM top_keys_global WHERE season_id = $1 ORDER BY keystone_level DESC, score DESC LIMIT $2 OFFSET $3;`;
  } else if (period_id && !dungeon_id) {
    // Use per-period view
    params = [season_id, period_id, limit, offset];
    sql = `SELECT id, keystone_level, score, rank, dungeon_id, duration_ms, completed_at, members FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT $3 OFFSET $4;`;
  } else if (dungeon_id && !period_id) {
    // Use per-dungeon view
    params = [season_id, dungeon_id, limit, offset];
    sql = `SELECT id, keystone_level, score, rank, dungeon_id, duration_ms, completed_at, members FROM top_keys_per_dungeon WHERE season_id = $1 AND dungeon_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT $3 OFFSET $4;`;
  } else {
    // Use per-group view
    let where = ['season_id = $1'];
    params = [season_id];
    idx = 2;
    if (period_id) { where.push(`period_id = $${idx}`); params.push(period_id); idx++; }
    if (dungeon_id) { where.push(`dungeon_id = $${idx}`); params.push(dungeon_id); idx++; }
    params.push(limit, offset);
    sql = `SELECT id, keystone_level, score, rank, dungeon_id, duration_ms, completed_at, members FROM top_keys_per_group WHERE ${where.join(' AND ')} ORDER BY season_id${period_id ? ', period_id' : ''}, dungeon_id, keystone_level DESC, score DESC LIMIT $${idx} OFFSET $${idx+1};`;
  }
  try {
    const { rows } = await db.pool.query(sql, params);
    
    // Get season metadata
    const seasonMetadata = SEASON_METADATA[season_id];
    
    // Return enhanced response with season metadata
    res.json({
      season_info: {
        season_id: parseInt(season_id),
        season_name: seasonMetadata?.name || `Season ${season_id}`,
        expansion: seasonMetadata?.expansion || 'Unknown',
        patch: seasonMetadata?.patch || 'Unknown'
      },
      meta: {
        total_runs: rows.length,
        limit: limit,
        offset: offset
      },
      data: rows
    });
  } catch (err) {
    console.error('[TOP KEYS ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /meta/top-keys-all-seasons
// Purpose: Retrieves top keys from all seasons for historical analysis
// Frontend Usage:
//   - CompAllSeasonsPage - Historical compositions across all seasons
// Returns data for each season with their top 1000 keys
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
        // Query the global view for each season (top 1000 keys) - optimized to only select needed fields
        const { rows } = await db.pool.query(
          'SELECT id, keystone_level, (SELECT json_agg(json_build_object(\'class_id\', m->>\'class_id\', \'spec_id\', m->>\'spec_id\', \'role\', m->>\'role\')) FROM json_array_elements(members) AS m) AS members FROM top_keys_global WHERE season_id = $1 ORDER BY keystone_level DESC, score DESC LIMIT 1000',
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

// GET /meta/composition-data/:season_id
// Purpose: Retrieves data optimized for group composition analysis (no character names)
// Frontend Usage:
//   - GroupCompositionPage - Group composition analysis
// Returns data optimized for composition analysis
router.get('/composition-data/:season_id', async (req, res) => {
  console.log(`📊 [META] GET /meta/composition-data/${req.params.season_id}`);
  const season_id = Number(req.params.season_id);
  if (!season_id) {
    return res.status(400).json({ error: 'season_id is required' });
  }

  try {
    // Use the helper function to get composition data for this season
    const result = await getCompositionDataForSeason(season_id);

    // If the season has no non-empty periods, return 404
    if (result === null) {
      return res.status(404).json({ error: 'No composition data found for this season' });
    }
    
    res.json(result);
  } catch (err) {
    console.error('[COMPOSITION DATA ERROR]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /meta/spec-evolution
// Purpose: Retrieves spec evolution data across all seasons
// Frontend Usage:
//   - MetaEvolutionPage - Meta evolution charts and trends
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
// Purpose: Retrieves spec evolution data for a specific season
// Frontend Usage:
//   - AIPredictionsPage - AI analysis with spec evolution data
//   - MetaEvolutionPage - Meta evolution charts for specific season
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