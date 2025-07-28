#!/usr/bin/env node

const axios = require('axios');

// Configuration for Render One-Off Job
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
        },
        timeout: 7200000, // 120 minutes
      };  

      if (data) {
        config.data = data;
      }

      console.log(`[PREVIOUS-PERIOD] Making ${method} request to ${endpoint} (attempt ${attempt}/${retries})`);
      const response = await axios(config);
      console.log(`[PREVIOUS-PERIOD] ${method} ${endpoint} - Status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[PREVIOUS-PERIOD ERROR] ${method} ${endpoint} failed (attempt ${attempt}/${retries}):`, error.response?.data || error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.log(`[PREVIOUS-PERIOD] Retrying in ${delay}ms...`);
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
    console.log(`[PREVIOUS-PERIOD] Latest season found: ${latestSeason.season_id} (${latestSeason.season_name})`);

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
      console.log(`[PREVIOUS-PERIOD] Current season has only 1 period, using previous season: ${previousSeason.season_id} (${previousSeason.season_name})`);
      
      const previousSeasonInfo = await makeRequest('GET', `/wow/advanced/season-info/${previousSeason.season_id}`);
      const previousSeasonPeriods = previousSeasonInfo.periods || [];
      if (!previousSeasonPeriods || previousSeasonPeriods.length === 0) {
        throw new Error(`No periods found for previous season ${previousSeason.season_id}`);
      }
      
      // Get the last period from the previous season
      const sortedPreviousPeriods = previousSeasonPeriods.sort((a, b) => b.period_id - a.period_id);
      targetSeasonId = previousSeason.season_id;
      targetPeriodId = sortedPreviousPeriods[0].period_id;
      
      console.log(`[PREVIOUS-PERIOD] Using last period from previous season: ${targetPeriodId}`);
    } else {
      // Current season has multiple periods, get the second to last period
      targetSeasonId = latestSeason.season_id;
      targetPeriodId = sortedPeriods[1].period_id; // Second to last period
      
      console.log(`[PREVIOUS-PERIOD] Using previous period from current season: ${targetPeriodId}`);
    }

    return {
      seasonId: targetSeasonId,
      periodId: targetPeriodId
    };
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to get previous season and period:', error.message);
    throw error;
  }
}

// Step 1: Fetch mythic leaderboard data for all regions
async function fetchLeaderboardData() {
  const { seasonId, periodId } = await getPreviousSeasonAndPeriod();
  
  console.log(`[PREVIOUS-PERIOD] Starting leaderboard data fetch for season ${seasonId}, period ${periodId}`);
  
  const results = [];
  
  for (const region of REGIONS) {
    try {
      console.log(`[PREVIOUS-PERIOD] Fetching data for region: ${region}`);
      const response = await makeRequest('GET', `/wow/advanced/mythic-leaderboard/${seasonId}/${periodId}?region=${region}`);
      
      results.push({
        region,
        status: 'success',
        data: response
      });
      
      console.log(`[PREVIOUS-PERIOD] Successfully fetched data for region ${region}`);
    } catch (error) {
      console.error(`[PREVIOUS-PERIOD ERROR] Failed to fetch data for region ${region}:`, error.message);
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
  console.log('[PREVIOUS-PERIOD] Starting import of leaderboard JSON files');
  
  try {
    const response = await makeRequest('POST', '/admin/import-all-leaderboard-json');
    console.log('[PREVIOUS-PERIOD] Successfully imported leaderboard data');
    return response;
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to import leaderboard data:', error.message);
    throw error;
  }
}

// Step 3: Clear output directory
async function clearOutput() {
  console.log('[PREVIOUS-PERIOD] Clearing output directory');
  
  try {
    const response = await makeRequest('POST', '/admin/clear-output');
    console.log('[PREVIOUS-PERIOD] Successfully cleared output directory');
    return response;
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to clear output directory:', error.message);
    throw error;
  }
}

// Step 4: Cleanup leaderboard data
async function cleanupLeaderboard(seasonId) {
  console.log(`[PREVIOUS-PERIOD] Cleaning up leaderboard data for season ${seasonId}`);
  
  try {
    const response = await makeRequest('POST', '/admin/cleanup-leaderboard', { season_id: seasonId });
    console.log('[PREVIOUS-PERIOD] Successfully cleaned up leaderboard data');
    return response;
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to cleanup leaderboard data:', error.message);
    throw error;
  }
}

// Step 5: Refresh materialized views
async function refreshViews() {
  console.log('[PREVIOUS-PERIOD] Refreshing materialized views');
  
  try {
    const response = await makeRequest('POST', '/admin/refresh-views');
    console.log('[PREVIOUS-PERIOD] Successfully refreshed materialized views');
    return response;
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to refresh materialized views:', error.message);
    throw error;
  }
}

async function vacuumFull() {
  console.log('[PREVIOUS-PERIOD] Performing VACUUM FULL on database');
  
  try {
    const response = await makeRequest('POST', '/admin/vacuum-full');
    console.log('[PREVIOUS-PERIOD] Successfully completed VACUUM FULL');
    return response;
  } catch (error) {
    console.error('[PREVIOUS-PERIOD ERROR] Failed to perform VACUUM FULL:', error.message);
    throw error;
  }
}

// Main automation function for Previous Period Job
async function runPreviousPeriodAutomation() {
  const startTime = new Date();
  console.log(`[PREVIOUS-PERIOD] Starting previous period automation at ${startTime.toISOString()}`);
  console.log(`[PREVIOUS-PERIOD] API Base URL: ${API_BASE_URL}`);
  
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
    
    // Step 5: Perform VACUUM FULL on database
    console.log('\n=== STEP 5: Performing VACUUM FULL ===');
    const vacuumResult = await vacuumFull();
    
    // Step 6: Refresh materialized views
    console.log('\n=== STEP 6: Refreshing materialized views ===');
    const refreshResult = await refreshViews();
    
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    
    console.log(`\n[PREVIOUS-PERIOD] Previous period automation completed successfully at ${endTime.toISOString()}`);
    console.log(`[PREVIOUS-PERIOD] Total duration: ${duration} seconds`);
    
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
    
    console.error(`\n[PREVIOUS-PERIOD] Previous period automation failed at ${endTime.toISOString()}`);
    console.error(`[PREVIOUS-PERIOD] Total duration: ${duration} seconds`);
    console.error(`[PREVIOUS-PERIOD] Error: ${error.message}`);
    
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
        console.log('[PREVIOUS-PERIOD] Automation completed successfully');
        process.exit(0);
      } else {
        console.error('[PREVIOUS-PERIOD] Automation failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('[PREVIOUS-PERIOD] Unexpected error:', error);
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
  refreshViews
}; 