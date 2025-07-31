#!/usr/bin/env node

const axios = require('axios');

// Configuration for Render WEEKLY Job
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const REGIONS = ['us', 'eu', 'kr', 'tw'];

// Helper function to make API requests with retry logic
async function makeRequest(method, endpoint, data = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `${API_BASE_URL}${endpoint}`;
      const config = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-API-Key': process.env.ADMIN_API_KEY
        },
        timeout: 21600000, // 6 hours
      };  

      if (data) {
        config.data = data;
      }

      // Validate admin API key is set
      if (!process.env.ADMIN_API_KEY) {
        throw new Error('ADMIN_API_KEY environment variable is not set');
      }

      console.log(`[WEEKLY] Making ${method} request to ${endpoint} (attempt ${attempt}/${retries})`);
      const response = await axios(config);
      console.log(`[WEEKLY] ${method} ${endpoint} - Status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[WEEKLY ERROR] ${method} ${endpoint} failed (attempt ${attempt}/${retries}):`, error.response?.data || error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.log(`[WEEKLY] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper function to get the previous season and period
async function getPreviousSeasonAndPeriod() {
  try {
    // Get seasons to find the latest one
    const seasonsResponse = await makeRequest('GET', '/wow/advanced/seasons');
    const seasons = seasonsResponse || [];
    if (!seasons || seasons.length === 0) {
      throw new Error('No seasons found');
    }
    
    // Sort seasons by season_id in descending order
    const sortedSeasons = seasons.sort((a, b) => b.season_id - a.season_id);
    const latestSeason = sortedSeasons[0];
    console.log(`[WEEKLY] Latest season found: ${latestSeason.season_id} (${latestSeason.season_name})`);

    // Get season info to find periods for this season
    const seasonInfo = await makeRequest('GET', `/wow/advanced/season-info/${latestSeason.season_id}`);
    const periods = seasonInfo.periods || [];
    if (!periods || periods.length === 0) {
      throw new Error(`No periods found for season ${latestSeason.season_id}`);
    }
    
    // Sort periods by period_id in descending order
    const sortedPeriods = periods.sort((a, b) => b.period_id - a.period_id);
    
    let targetSeasonId, targetPeriodId;
    
    if (sortedPeriods.length === 1) {
      // Current season only has 1 period, so we need to get the last period from the previous season
      if (sortedSeasons.length < 2) {
        throw new Error('No previous season available');
      }
      
      const previousSeason = sortedSeasons[1];
      console.log(`[WEEKLY] Current season has only 1 period, using previous season: ${previousSeason.season_id} (${previousSeason.season_name})`);
      
      const previousSeasonInfo = await makeRequest('GET', `/wow/advanced/season-info/${previousSeason.season_id}`);
      const previousSeasonPeriods = previousSeasonInfo.periods || [];
      if (!previousSeasonPeriods || previousSeasonPeriods.length === 0) {
        throw new Error(`No periods found for previous season ${previousSeason.season_id}`);
      }
      
      // Get the last period from the previous season
      const sortedPreviousPeriods = previousSeasonPeriods.sort((a, b) => b.period_id - a.period_id);
      targetSeasonId = previousSeason.season_id;
      targetPeriodId = sortedPreviousPeriods[0].period_id;
      
      console.log(`[WEEKLY] Using last period from previous season: ${targetPeriodId}`);
    } else {
      // Current season has multiple periods, get the second to last period
      targetSeasonId = latestSeason.season_id;
      targetPeriodId = sortedPeriods[1].period_id; // Second to last period
      
      console.log(`[WEEKLY] Using previous period from current season: ${targetPeriodId}`);
    }

    return {
      seasonId: targetSeasonId,
      periodId: targetPeriodId
    };
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to get previous season and period:', error.message);
    throw error;
  }
}

// Step 1: Fetch mythic leaderboard data for all regions
async function fetchLeaderboardData() {
  const { seasonId, periodId } = await getPreviousSeasonAndPeriod();
  
  console.log(`[WEEKLY] Starting leaderboard data fetch for season ${seasonId}, period ${periodId}`);
  
  const results = [];
  
  for (const region of REGIONS) {
    try {
      console.log(`[WEEKLY] Fetching data for region: ${region}`);
      const response = await makeRequest('GET', `/wow/advanced/mythic-leaderboard/${seasonId}/${periodId}?region=${region}`);
      
      results.push({
        region,
        status: 'success',
        data: response
      });
      
      console.log(`[WEEKLY] Successfully fetched data for region ${region}`);
    } catch (error) {
      console.error(`[WEEKLY ERROR] Failed to fetch data for region ${region}:`, error.message);
      results.push({
        region,
        status: 'error',
        error: error.message
      });
    }
  }
  
  return { seasonId, periodId, results };
}

// Step 2: Import all leaderboard JSON files
async function importLeaderboardData() {
  console.log('[WEEKLY] Starting import of leaderboard JSON files');
  
  try {
    const response = await makeRequest('POST', '/admin/import-all-leaderboard-json');
    console.log('[WEEKLY] Successfully imported leaderboard data');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to import leaderboard data:', error.message);
    throw error;
  }
}

// Step 3: Clear output directory
async function clearOutput() {
  console.log('[WEEKLY] Clearing output directory');
  
  try {
    const response = await makeRequest('POST', '/admin/clear-output');
    console.log('[WEEKLY] Successfully cleared output directory');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to clear output directory:', error.message);
    throw error;
  }
}

// Step 4: Cleanup leaderboard data
async function cleanupLeaderboard(seasonId) {
  console.log(`[WEEKLY] Cleaning up leaderboard data for season ${seasonId}`);
  
  try {
    const response = await makeRequest('POST', '/admin/cleanup-leaderboard', { season_id: seasonId });
    console.log('[WEEKLY] Successfully cleaned up leaderboard data');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to cleanup leaderboard data:', error.message);
    throw error;
  }
}

// Step 5: Refresh materialized views
async function refreshViews() {
  console.log('[WEEKLY] Refreshing materialized views');
  
  try {
    const response = await makeRequest('POST', '/admin/refresh-views');
    console.log('[WEEKLY] Successfully refreshed materialized views');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to refresh materialized views:', error.message);
    throw error;
  }
}

async function vacuumFull() {
  console.log('[WEEKLY] Performing VACUUM FULL on database');
  
  try {
    const response = await makeRequest('POST', '/admin/vacuum-full');
    console.log('[WEEKLY] Successfully completed VACUUM FULL');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to perform VACUUM FULL:', error.message);
    console.error('[WEEKLY] This operation may have timed out. Consider running during low-traffic periods.');
    throw error;
  }
}

async function vacuumAnalyze() {
  console.log('[WEEKLY] Performing VACUUM ANALYZE on database');
  
  try {
    const response = await makeRequest('POST', '/admin/vacuum-analyze');
    console.log('[WEEKLY] Successfully completed VACUUM ANALYZE');
    return response;
  } catch (error) {
    console.error('[WEEKLY ERROR] Failed to perform VACUUM ANALYZE:', error.message);
    console.error('[WEEKLY] This operation may have timed out. Consider running during low-traffic periods.');
    throw error;
  }
}

// Main automation function for Previous Period Job
async function runPreviousPeriodAutomation() {
  const startTime = new Date();
  console.log(`[WEEKLY] Starting previous period automation at ${startTime.toISOString()}`);
  console.log(`[WEEKLY] API Base URL: ${API_BASE_URL}`);
  
  try {
    // Step 1: Fetch leaderboard data for all regions
    console.log('\n=== STEP 1: Fetching leaderboard data ===');
    const fetchResult = await fetchLeaderboardData();
    
    // Step 2: Import all leaderboard JSON files
    console.log('\n=== STEP 2: Importing leaderboard data ===');
    const importResult = await importLeaderboardData();
    
    // Step 3: Clear output directory
    console.log('\n=== STEP 3: Clearing output directory ===');
    const clearResult = await clearOutput();
    
    // Step 4: Cleanup leaderboard data
    console.log('\n=== STEP 4: Cleaning up leaderboard data ===');
    const cleanupResult = await cleanupLeaderboard(fetchResult.seasonId);
    
    // Step 5: Perform VACUUM ANALYZE on database
    console.log('\n=== STEP 5: Performing VACUUM ANALYZE ===');
    const vacuumResult = await vacuumAnalyze();
    
    // Step 6: Refresh materialized views
    console.log('\n=== STEP 6: Refreshing materialized views ===');
    const refreshResult = await refreshViews();
    
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n[WEEKLY] Previous period automation completed successfully at ${endTime.toISOString()}`);
    console.log(`[WEEKLY] Total duration: ${duration} seconds`);
    
    return {
      status: 'success',
      duration,
      results: {
        fetch: fetchResult,
        import: importResult,
        clear: clearResult,
        cleanup: cleanupResult,
        vacuum: vacuumResult,
        refresh: refreshResult
      }
    };
    
  } catch (error) {
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    
    console.error(`\n[WEEKLY] Previous period automation failed at ${endTime.toISOString()}`);
    console.error(`[WEEKLY] Total duration: ${duration} seconds`);
    console.error(`[WEEKLY] Error: ${error.message}`);
    
    return {
      status: 'error',
      duration,
      error: error.message
    };
  }
}

// Run the automation if this script is executed directly
if (require.main === module) {
  runPreviousPeriodAutomation()
    .then(result => {
      if (result.status === 'success') {
        console.log('[WEEKLY] Automation completed successfully');
        process.exit(0);
      } else {
        console.error('[WEEKLY] Automation failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('[WEEKLY] Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = {
  runPreviousPeriodAutomation,
  fetchLeaderboardData,
  importLeaderboardData,
  clearOutput,
  cleanupLeaderboard,
  vacuumFull,
  vacuumAnalyze,
  refreshViews
}; 