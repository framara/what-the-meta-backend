#!/usr/bin/env node

// Load local environment vars if present
try { require('dotenv').config(); } catch (_) {}

const axios = require('axios');

// Configuration for Render DAILY Job
// Prefer INTERNAL_API_BASE when present (explicit server URL), else API_BASE_URL, else localhost
const API_BASE_URL = process.env.INTERNAL_API_BASE || process.env.API_BASE_URL || 'http://localhost:3000';
// Job-wide deadline control to prevent overruns (addresses timeout checks around request loop)
const JOB_START_TS = Date.now();
const ENV_MAX_MS = Number(process.env.JOB_MAX_RUNTIME_MS || 0);
const TTL_SEC = Number(process.env.JOB_LOCK_TTL_SECONDS || 0);
// If explicit max runtime set, honor it; else derive from lock TTL with a 60s buffer
const JOB_DEADLINE = ENV_MAX_MS > 0
  ? (JOB_START_TS + ENV_MAX_MS)
  : (TTL_SEC > 0 ? (JOB_START_TS + TTL_SEC * 1000 - 60000) : null);
function remainingJobTimeMs() {
  return JOB_DEADLINE ? (JOB_DEADLINE - Date.now()) : Infinity;
}
const REGIONS = ['us', 'eu', 'kr', 'tw'];
const LOCK_NAME = process.env.JOB_LOCK_NAME || 'automation-global-lock';
let HAS_LOCK = false;

// Helper function to make API requests with retry logic
// options: { timeoutMs?: number, deadlineTs?: number }
async function makeRequest(method, endpoint, data = null, retries = 3, options = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `${API_BASE_URL}${endpoint}`;
      const deadlineTs = options.deadlineTs || JOB_DEADLINE || null;
      if (deadlineTs) {
        const remaining = deadlineTs - Date.now();
        if (remaining <= 0) {
          throw new Error('Job deadline exceeded before request');
        }
      }
      const config = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-API-Key': process.env.ADMIN_API_KEY
        },
        // Default to 2 hours, but allow per-call override, and cap by remaining job time
        timeout: (() => {
          const base = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 7200000;
          if (!deadlineTs) return base;
          const remaining = Math.max(0, deadlineTs - Date.now() - 2000); // 2s safety
          return Math.max(1000, Math.min(base, remaining));
        })(),
      };  

      if (data) {
        config.data = data;
      }

      // Validate admin API key is set
      if (!process.env.ADMIN_API_KEY) {
        throw new Error('ADMIN_API_KEY environment variable is not set');
      }

      console.log(`[DAILY] Making ${method} request to ${endpoint} (attempt ${attempt}/${retries}, timeout=${config.timeout}ms)`);
      const response = await axios(config);
      if (deadlineTs && Date.now() > deadlineTs) {
        throw new Error('Job deadline exceeded after request');
      }
      console.log(`[DAILY] ${method} ${endpoint} - Status: ${response.status}`);
      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;
      console.error(`[DAILY ERROR] ${method} ${endpoint} failed (attempt ${attempt}/${retries}):`, error.response?.data || error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Special handling for database connection errors - longer delays
  const isDatabaseError = errorMessage.includes('not yet accepting connections') || 
             errorMessage.includes('connection error') ||
             errorMessage.includes('Client has encountered a connection error') ||
             errorMessage.includes('Connection terminated unexpectedly') ||
             errorMessage.includes('ECONNRESET') ||
             errorMessage.includes('EHOSTUNREACH');
      
      let delay;
      if (isDatabaseError) {
        // Longer delays for database connectivity issues
        delay = Math.min(120000, Math.pow(2, attempt) * 5000); // Up to 120s delay
        console.log(`[DAILY] Database connectivity issue detected. Retrying in ${delay}ms...`);
      } else {
        // Standard exponential backoff for other errors
        delay = Math.pow(2, attempt) * 1000;
        console.log(`[DAILY] Retrying in ${delay}ms...`);
      }
      // Respect the job-wide deadline when delaying
      const rem = remainingJobTimeMs();
      if (rem <= 0) {
        throw new Error('Job deadline exceeded before retry');
      }
      if (rem < delay + 500) {
        delay = Math.max(0, rem - 500);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Poll the API until the database is responsive. Uses a lightweight stats endpoint.
async function waitForDatabaseReady(maxWaitMs = 10 * 60 * 1000, pingIntervalMs = 5000) {
  const started = Date.now();
  const rem0 = remainingJobTimeMs();
  if (Number.isFinite(rem0)) {
    maxWaitMs = Math.max(1000, Math.min(maxWaitMs, rem0 - 2000));
  }
  let tries = 0;
  while (Date.now() - started < maxWaitMs) {
    tries += 1;
    try {
      await makeRequest('GET', '/admin/db/stats', null, 1, { timeoutMs: 15000 });
      if (tries > 1) {
        console.log(`[DAILY] Database became ready after ${(Date.now() - started) / 1000}s and ${tries} checks.`);
      }
      return true;
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || '';
      if (msg && (msg.includes('not yet accepting connections') || msg.includes('connection') || msg.includes('timeout'))) {
        console.log(`[DAILY] Waiting for database readiness... retrying in ${pingIntervalMs}ms`);
      } else {
        console.log(`[DAILY] Transient error while checking DB readiness (${msg || 'unknown'}). Retrying in ${pingIntervalMs}ms`);
      }
      const remNow = remainingJobTimeMs();
      if (remNow <= pingIntervalMs + 500) {
        pingIntervalMs = Math.max(250, remNow - 500);
      }
      await new Promise(r => setTimeout(r, pingIntervalMs));
    }
  }
  throw new Error(`Database did not become ready within ${Math.round(maxWaitMs / 1000)}s`);
}

// Job lock helpers
function getLockOwner() {
  const origin = process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local';
  return process.env.JOB_LOCK_OWNER || `${origin}:daily:${process.pid}`;
}

async function acquireJobLock(ttlSeconds = undefined) {
  try {
    const body = { lock_name: LOCK_NAME, owner: getLockOwner(), job: 'daily' };
    if (ttlSeconds) body.ttl_seconds = ttlSeconds;
    const resp = await makeRequest('POST', '/admin/job-lock/acquire', body, 1);
    console.log('[DAILY] Acquired job lock');
    HAS_LOCK = true;
    return { acquired: true, lock: resp.lock || resp };
  } catch (err) {
    const data = err.response?.data;
    if (data && data.status === 'LOCKED') {
      console.log(`[DAILY] Job lock is held by owner ${data.current?.owner} until ${data.current?.expires_at}`);
      // Optionally try to steal once if configured and past grace
      const allowSteal = String(process.env.JOB_LOCK_STEAL || 'false').toLowerCase() === 'true';
      const stealGraceMs = Number(process.env.JOB_LOCK_STEAL_GRACE_MS || 0);
      const now = Date.now();
      const exp = data.current?.expires_at ? Date.parse(data.current.expires_at) : 0;
      if (allowSteal && (exp > 0 && now + stealGraceMs >= exp)) {
        console.log('[DAILY] Attempting to steal stuck job lock...');
        try {
          const body = { lock_name: LOCK_NAME, owner: getLockOwner(), job: 'daily', steal: true };
          if (ttlSeconds) body.ttl_seconds = ttlSeconds;
          const resp2 = await makeRequest('POST', '/admin/job-lock/acquire', body, 1);
          console.log('[DAILY] Stole job lock');
          HAS_LOCK = true;
          return { acquired: true, lock: resp2.lock || resp2 };
        } catch (_) {
          // Fall through
        }
      }
      return { acquired: false, current: data.current };
    }
    throw err;
  }
}

async function releaseJobLock() {
  try {
    if (!HAS_LOCK) return;
    // Try multiple times with short timeouts to avoid long hangs
    await makeRequest('POST', '/admin/job-lock/release', { lock_name: LOCK_NAME, owner: getLockOwner() }, 5, { timeoutMs: 20000 });
    HAS_LOCK = false;
    console.log('[DAILY] Released job lock');
  } catch (err) {
    console.warn('[DAILY] Failed to release job lock (it may have expired or been taken over):', err.response?.data || err.message);
  }
}

function setupSignalHandlers() {
  let shuttingDown = false;
  const gracefulExit = async (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await releaseJobLock(); } catch (_) {}
    process.exit(code);
  };
  process.on('SIGINT', () => {
    console.log('[DAILY] Caught SIGINT');
    gracefulExit(130);
  });
  process.on('SIGTERM', () => {
    console.log('[DAILY] Caught SIGTERM');
    gracefulExit(143);
  });
  process.on('uncaughtException', async (err) => {
    console.error('[DAILY] Uncaught exception:', err);
    await gracefulExit(1);
  });
  process.on('unhandledRejection', async (reason) => {
    console.error('[DAILY] Unhandled rejection:', reason);
    await gracefulExit(1);
  });
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
    console.log(`[DAILY] Latest season found: ${latestSeason.season_id} (${latestSeason.season_name})`);

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
    console.log(`[DAILY] Latest period found: ${latestPeriod.period_id}`);

    return {
      seasonId: latestSeason.season_id,
      periodId: latestPeriod.period_id
    };
  } catch (error) {
    console.error('[DAILY ERROR] Failed to get latest season and period:', error.message);
    throw error;
  }
}

// Step 1: Fetch mythic leaderboard data for all regions
async function fetchLeaderboardData() {
  const { seasonId, periodId } = await getLatestSeasonAndPeriod();
  
  console.log(`[DAILY] Starting leaderboard data fetch for season ${seasonId}, period ${periodId}`);
  
  const results = [];
  
  for (const region of REGIONS) {
    try {
      console.log(`[DAILY] Fetching data for region: ${region}`);
      const response = await makeRequest('GET', `/wow/advanced/mythic-leaderboard/${seasonId}/${periodId}?region=${region}`);
      
      results.push({
        region,
        status: 'success',
        data: response
      });
      
      console.log(`[DAILY] Successfully fetched data for region ${region}`);
    } catch (error) {
      console.error(`[DAILY ERROR] Failed to fetch data for region ${region}:`, error.message);
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
  console.log('[DAILY] Starting import of leaderboard JSON files');

  // Check database connectivity before starting import
  try {
    console.log('[DAILY] Verifying database connectivity...');
  await makeRequest('GET', '/admin/db/stats', null, 1, { timeoutMs: 15000 });
    console.log('[DAILY] Database connectivity verified');
  } catch (error) {
    console.error('[DAILY ERROR] Database connectivity check failed:', error.message);
    console.log('[DAILY] Waiting 30 seconds for database to become available...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Retry once more
    try {
  await makeRequest('GET', '/admin/db/stats', null, 1, { timeoutMs: 15000 });
      console.log('[DAILY] Database connectivity verified after retry');
    } catch (retryError) {
      throw new Error(`Database not ready for import after retry: ${retryError.message}`);
    }
  }

  // Loop in smaller batches to avoid upstream 502s/timeouts
  // Tune within safe defaults; delete processed files to avoid reprocessing
  const qs = (params) => {
    const esc = encodeURIComponent;
    return Object.keys(params).map(k => `${esc(k)}=${esc(String(params[k]))}`).join('&');
  };
  const batchSize = Number(process.env.IMPORT_BATCH_SIZE || 30);
  const maxBatchesPerRequest = Number(process.env.IMPORT_MAX_BATCHES || 2);
  const concurrency = Number(process.env.IMPORT_CONCURRENCY || 4);
  const deleteProcessed = String(process.env.IMPORT_DELETE || 'true');

  let grandTotalRuns = 0;
  let grandTotalMembers = 0;
  let totalProcessedFiles = 0;
  let remaining = null;
  let batches = 0;

  while (true) {
    if (JOB_DEADLINE && Date.now() > JOB_DEADLINE) {
      throw new Error('Job deadline exceeded during import');
    }
    const query = qs({ batch_size: batchSize, max_batches: maxBatchesPerRequest, concurrency, delete_processed: deleteProcessed });
    try {
      const resp = await makeRequest('POST', `/admin/import-all-leaderboard-json-fast?${query}`);
      grandTotalRuns += resp.totalRuns || 0;
      grandTotalMembers += resp.totalMembers || 0;
      totalProcessedFiles += resp.processedFilesCount || 0;
      remaining = typeof resp.remainingFiles === 'number' ? resp.remainingFiles : null;
      batches += resp.batchesProcessed || 0;

      console.log(`[DAILY] Import progress: batches=${batches}, processed_files=${totalProcessedFiles}, remaining=${remaining}, runs=${grandTotalRuns}, members=${grandTotalMembers}`);

      if (!remaining || remaining <= 0) break;
    } catch (error) {
      const status = error?.response?.status;
      const errData = error?.response?.data;
      const errMsg = errData?.error || error.message;
      if (status === 404 && (errMsg?.includes('Output directory not found') || errMsg?.includes('No JSON files found'))) {
        console.warn('[DAILY] No files to import (output directory missing or empty). Skipping import.');
        break;
      }
      console.error('[DAILY ERROR] Failed to import leaderboard data:', errMsg);
      throw error;
    }
  }

  console.log(`[DAILY] Successfully imported leaderboard data. Total runs=${grandTotalRuns}, members=${grandTotalMembers}`);
  return { status: 'OK', totalRuns: grandTotalRuns, totalMembers: grandTotalMembers, processedFiles: totalProcessedFiles };
}

// Step 3: Clear output directory
async function clearOutput() {
  console.log('[DAILY] Clearing output directory');
  
  try {
  const response = await makeRequest('POST', '/admin/clear-output', null, 3, { timeoutMs: 90000 });
    console.log('[DAILY] Successfully cleared output directory');
    return response;
  } catch (error) {
    const status = error?.response?.status;
    const errData = error?.response?.data;
    const errMsg = errData?.error || error.message;
    // If directory does not exist, consider it already cleared
    if (status === 404 && errMsg?.includes('Output directory not found')) {
      console.warn('[DAILY] Output directory does not exist. Considered already cleared.');
      return { status: 'OK', deleted: [], errors: [], note: 'Output directory was missing' };
    }
    console.error('[DAILY ERROR] Failed to clear output directory:', errMsg);
    throw error;
  }
}

// Step 4: Cleanup leaderboard data
async function cleanupLeaderboard(seasonId) {
  console.log(`[DAILY] Cleaning up leaderboard data for season ${seasonId}`);
  
  try {
    // Ensure DB is up before starting a potentially long-running cleanup
    await waitForDatabaseReady();
    const response = await makeRequest('POST', '/admin/cleanup-leaderboard', { season_id: seasonId }, 6, { timeoutMs: 90000 });
    console.log('[DAILY] Successfully cleaned up leaderboard data');
    return response;
  } catch (error) {
    console.error('[DAILY ERROR] Failed to cleanup leaderboard data:', error.message);
    throw error;
  }
}

// Step 5: Refresh materialized views
async function refreshViews() {
  const skipRefresh = String(process.env.SKIP_REFRESH_VIEWS || 'false').toLowerCase() === 'true';
  
  if (skipRefresh) {
    console.log('[DAILY] Skipping materialized views refresh (SKIP_REFRESH_VIEWS=true)');
    return { status: 'SKIPPED', message: 'Refresh views skipped via environment variable' };
  }
  
  console.log('[DAILY] Starting materialized views refresh in background (non-blocking)');
  console.log('[DAILY] This process will continue in the background after automation completes');
  
  try {
    // Use async endpoint to avoid timeout issues
  const response = await makeRequest('POST', '/admin/refresh-views-async', null, 3, { timeoutMs: 60000 });
    console.log('[DAILY] Successfully started materialized views refresh in background');
    console.log('[DAILY] Check server logs for progress updates on materialized views refresh');
    
    // Optional: Add info about checking status via database query
    console.log('[DAILY] To check if materialized views are still refreshing, you can query:');
    console.log('[DAILY]   SELECT pid, state, query FROM pg_stat_activity WHERE query LIKE \'%REFRESH MATERIALIZED VIEW%\';');
    
    return response;
  } catch (error) {
    console.error('[DAILY ERROR] Failed to start materialized views refresh:', error.message);
    throw error;
  }
}

// Pre-step: Populate reference data (seasons, dungeons, periods, realms)
async function populateReferenceData() {
  console.log('[DAILY] Populating reference data (seasons, dungeons, periods, realms)');
  const results = {};
  try {
    const [seasonsRes, dungeonsRes, periodsRes, realmsRes] = await Promise.allSettled([
      makeRequest('POST', '/admin/populate-seasons'),
      makeRequest('POST', '/admin/populate-dungeons'),
      makeRequest('POST', '/admin/populate-periods'),
      makeRequest('POST', '/admin/populate-realms')
    ]);

    results.seasons = seasonsRes.status === 'fulfilled' ? seasonsRes.value : { status: 'ERROR', error: seasonsRes.reason?.message || String(seasonsRes.reason) };
    results.dungeons = dungeonsRes.status === 'fulfilled' ? dungeonsRes.value : { status: 'ERROR', error: dungeonsRes.reason?.message || String(dungeonsRes.reason) };
    results.periods = periodsRes.status === 'fulfilled' ? periodsRes.value : { status: 'ERROR', error: periodsRes.reason?.message || String(periodsRes.reason) };
    results.realms = realmsRes.status === 'fulfilled' ? realmsRes.value : { status: 'ERROR', error: realmsRes.reason?.message || String(realmsRes.reason) };

    console.log('[DAILY] Populate results:', {
      seasons: results.seasons.status || 'OK',
      dungeons: results.dungeons.status || 'OK',
      periods: results.periods.status || 'OK',
      realms: results.realms.status || 'OK'
    });

    return results;
  } catch (error) {
    console.error('[DAILY ERROR] Failed during populate reference data:', error.message);
    throw error;
  }
}

async function vacuumAnalyze() {
  console.log('[DAILY] Performing VACUUM ANALYZE on database');
  
  try {
    await waitForDatabaseReady();
    const response = await makeRequest('POST', '/admin/vacuum-analyze', null, 3, { timeoutMs: 5 * 60 * 1000 });
    console.log('[DAILY] Successfully completed VACUUM ANALYZE');
    return response;
  } catch (error) {
    console.error('[DAILY ERROR] Failed to perform VACUUM ANALYZE:', error.message);
    throw error;
  }
}

// Main automation function for DAILY Job
async function runOneOffAutomation() {
  const startTime = new Date();
  console.log(`[DAILY] Starting DAILY automation at ${startTime.toISOString()}`);
  console.log(`[DAILY] API Base URL: ${API_BASE_URL}`);
  
  try {
    // Acquire global job lock (allow shorter TTL via env)
    const ttl = Number(process.env.JOB_LOCK_TTL_SECONDS || 0) || undefined;
    const lock = await acquireJobLock(ttl);
    if (!lock.acquired) {
      return {
        status: 'skipped',
        reason: 'Another job is running',
        holder: lock.current
      };
    }
    
    // Step 0: Populate reference data
    console.log('\n=== STEP 0: Populating reference data ===');
    const populateResult = await populateReferenceData();
    
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
    
    console.log(`\n[DAILY] DAILY automation completed successfully at ${endTime.toISOString()}`);
    console.log(`[DAILY] Total duration: ${duration} seconds`);
    
    // Release the lock with retries and DB readiness check
    try {
      await waitForDatabaseReady(5 * 60 * 1000, 5000);
    } catch (_) {}
    await releaseJobLock();

    return {
      status: 'success',
      duration,
      results: {
        populate: populateResult,
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
    
    console.error(`\n[DAILY] DAILY automation failed at ${endTime.toISOString()}`);
    console.error(`[DAILY] Total duration: ${duration} seconds`);
    console.error(`[DAILY] Error: ${error.message}`);
    
    // Try to release lock even on failure; tolerate DB restarts
    try {
      await waitForDatabaseReady(5 * 60 * 1000, 5000);
    } catch (_) {}
    await releaseJobLock();

    return {
      status: 'error',
      duration,
      error: error.message
    };
  }
}

// Run the automation if this script is executed directly
if (require.main === module) {
  setupSignalHandlers();
  runOneOffAutomation()
    .then(result => {
      if (result.status === 'success' || result.status === 'skipped') {
        console.log('[DAILY] Automation completed successfully');
        process.exit(0);
      } else {
        console.error('[DAILY] Automation failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('[DAILY] Unexpected error:', error);
      process.exit(1);
    });
}

module.exports = {
  runOneOffAutomation,
  fetchLeaderboardData,
  importLeaderboardData,
  clearOutput,
  cleanupLeaderboard,
  vacuumAnalyze,
  refreshViews
}; 