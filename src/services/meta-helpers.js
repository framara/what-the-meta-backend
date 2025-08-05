const db = require('./db');
const { SEASON_METADATA, EXPANSION_METADATA } = require('../config/constants');

/**
 * Helper function to get spec evolution data for a specific season
 * @param {number} season_id - The season ID
 * @returns {Promise<Object|null>} - Spec evolution data or null if no data
 */
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

/**
 * Helper function to get composition data for a specific season
 * @param {number} season_id - The season ID
 * @returns {Promise<Object|null>} - Composition data or null if no data
 */
async function getCompositionDataForSeason(season_id) {
  // Get all periods for the season
  const periodsResult = await db.pool.query(
    'SELECT id FROM period WHERE season_id = $1 ORDER BY id',
    [season_id]
  );
  const periods = periodsResult.rows;

  if (periods.length === 0) {
    return null; // Return null for seasons with no periods
  }

  // Get top 1000 keys for each period (optimized - no character names)
  const seasonData = [];
  for (const period of periods) {
    const keysResult = await db.pool.query(
      'SELECT id, keystone_level, score, (SELECT json_agg(json_build_object(\'class_id\', m->>\'class_id\', \'spec_id\', m->>\'spec_id\', \'role\', m->>\'role\')) FROM json_array_elements(members) AS m) AS members FROM top_keys_per_period WHERE season_id = $1 AND period_id = $2 ORDER BY keystone_level DESC, score DESC LIMIT 1000',
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

  return {
    season_id,
    total_periods: totalPeriods,
    total_keys: totalKeys,
    periods: seasonData
  };
}

module.exports = {
  getSpecEvolutionForSeason,
  getCompositionDataForSeason
}; 