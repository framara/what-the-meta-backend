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

      console.log(`[ONE-OFF] Making ${method} request to ${endpoint} (attempt ${attempt}/${retries})`);
      const response = await axios(config);
      console.log(`[ONE-OFF] ${method} ${endpoint} - Status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[ONE-OFF ERROR] ${method} ${endpoint} failed (attempt ${attempt}/${retries}):`, error.response?.data || error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry
      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      console.log(`[ONE-OFF] Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper function to get the latest season and period
async function getLatestSeasonAndPeriod() {
  try {
    // Get seasons to find the latest one
    const seasonsResponse = await makeRequest('GET', '/wow/advanced/seasons');
    const seasons = seasonsResponse || [];
    if (!seasons || seasons.length === 0) {
      throw new Error('No seasons found');
    }
    // Find the latest season (highest season_id)
    const latestSeason = seasons.reduce((latest, current) =>
      current.season_id > latest.season_id ? current : latest
    );
    console.log(`[ONE-OFF] Latest season found: ${latestSeason.season_id} (${latestSeason.season_name})`);

    // Get season info to find periods for this season
    const seasonInfo = await makeRequest('GET', `/wow/advanced/season-info/${latestSeason.season_id}`);
    const periods = seasonInfo.periods || [];
    if (!periods || periods.length === 0) {
      throw new Error(`No periods found for season ${latestSeason.season_id}`);
    }
    // Find the latest period (highest period_id)
    const latestPeriod = periods.reduce((latest, current) =>
      current.period_id > latest.period_id ? current : latest
    );
    console.log(`[ONE-OFF] Latest period found: ${latestPeriod.period_id}`);

    return {
      seasonId: latestSeason.season_id,
      periodId: latestPeriod.period_id
    };
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to get latest season and period:', error.message);
    throw error;
  }
}

// Step 1: Fetch mythic leaderboard data for all regions
async function fetchLeaderboardData() {
  const { seasonId, periodId } = await getLatestSeasonAndPeriod();
  
  console.log(`[ONE-OFF] Starting leaderboard data fetch for season ${seasonId}, period ${periodId}`);
  
  const results = [];
  
  for (const region of REGIONS) {
    try {
      console.log(`[ONE-OFF] Fetching data for region: ${region}`);
      const response = await makeRequest('GET', `/wow/advanced/mythic-leaderboard/${seasonId}/${periodId}?region=${region}`);
      
      results.push({
        region,
        status: 'success',
        data: response
      });
      
      console.log(`[ONE-OFF] Successfully fetched data for region ${region}`);
    } catch (error) {
      console.error(`[ONE-OFF ERROR] Failed to fetch data for region ${region}:`, error.message);
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
  console.log('[ONE-OFF] Starting import of leaderboard JSON files');
  
  try {
    const response = await makeRequest('POST', '/admin/import-all-leaderboard-json');
    console.log('[ONE-OFF] Successfully imported leaderboard data');
    return response;
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to import leaderboard data:', error.message);
    throw error;
  }
}

// Step 3: Clear output directory
async function clearOutput() {
  console.log('[ONE-OFF] Clearing output directory');
  
  try {
    const response = await makeRequest('POST', '/admin/clear-output');
    console.log('[ONE-OFF] Successfully cleared output directory');
    return response;
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to clear output directory:', error.message);
    throw error;
  }
}

// Step 4: Cleanup leaderboard data
async function cleanupLeaderboard(seasonId) {
  console.log(`[ONE-OFF] Cleaning up leaderboard data for season ${seasonId}`);
  
  try {
    const response = await makeRequest('POST', '/admin/cleanup-leaderboard', { season_id: seasonId });
    console.log('[ONE-OFF] Successfully cleaned up leaderboard data');
    return response;
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to cleanup leaderboard data:', error.message);
    throw error;
  }
}

// Step 5: Refresh materialized views
async function refreshViews() {
  console.log('[ONE-OFF] Refreshing materialized views');
  
  try {
    const response = await makeRequest('POST', '/admin/refresh-views');
    console.log('[ONE-OFF] Successfully refreshed materialized views');
    return response;
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to refresh materialized views:', error.message);
    throw error;
  }
}

async function vacuumFull() {
  console.log('[ONE-OFF] Performing VACUUM FULL on database');
  
  try {
    const response = await makeRequest('POST', '/admin/vacuum-full');
    console.log('[ONE-OFF] Successfully completed VACUUM FULL');
    return response;
  } catch (error) {
    console.error('[ONE-OFF ERROR] Failed to perform VACUUM FULL:', error.message);
    throw error;
  }
}

// Main automation function for One-Off Job
async function runOneOffAutomation() {
  const startTime = new Date();
  console.log(`[ONE-OFF] Starting one-off automation at ${startTime.toISOString()}`);
  console.log(`[ONE-OFF] API Base URL: ${API_BASE_URL}`);
  
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
    
    console.log(`\n[ONE-OFF] One-off automation completed successfully at ${endTime.toISOString()}`);
    console.log(`[ONE-OFF] Total duration: ${duration} seconds`);
    
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
    
    console.error(`\n[ONE-OFF] One-off automation failed at ${endTime.toISOString()}`);
    console.error(`[ONE-OFF] Total duration: ${duration} seconds`);
    console.error(`[ONE-OFF] Error: ${error.message}`);
    
    return {
      status: 'error',
      duration,
      error: error.message
    };
  }
}

// Run the automation if this script is executed directly
if (require.main === module) {
  runOneOffAutomation()
    .then(result => {
      if (result.status === 'success') {
        console.log('[ONE-OFF] Automation completed successfully');
        process.exit(0);
      } else {
        console.error('[ONE-OFF] Automation failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('[ONE-OFF] Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = {
  runOneOffAutomation,
  fetchLeaderboardData,
  importLeaderboardData,
  clearOutput,
  cleanupLeaderboard,
  vacuumFull,
  refreshViews
}; 