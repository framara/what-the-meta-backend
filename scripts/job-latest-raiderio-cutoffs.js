#!/usr/bin/env node

require('dotenv').config();
const axios = require('axios');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
function parseCsvStrings(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}
const REGIONS = parseCsvStrings(process.env.BACKFILL_REGIONS || process.env.RIO_REGIONS, ['us', 'eu', 'kr', 'tw']);
const EXPANSIONS = (process.env.RIO_EXPANSIONS || '10,9')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n));
// Use a dedicated lock name for this job so it never conflicts with daily/weekly,
// even if JOB_LOCK_NAME is set globally in the environment.
const LOCK_NAME = process.env.RIO_JOB_LOCK_NAME || 'raiderio-latest-cutoffs-lock';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.ADMIN_KEY || '';
let HAS_LOCK = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Env helpers (shared)
function getEnvBool(keys, defaultVal = false) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(process.env, k)) {
      const v = String(process.env[k]).toLowerCase();
      return v === 'true' || v === '1' || v === 'yes';
    }
  }
  return defaultVal;
}

function getEnvNumber(keys) {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(process.env, k)) {
      const n = Number(process.env[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return NaN;
}

// Helper: make API request with retries
async function makeRequest(method, endpoint, data = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const url = `${API_BASE_URL}${endpoint}`;
      const config = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-API-Key': ADMIN_API_KEY
        },
        timeout: 7200000,
      };

      if (data) config.data = data;

      if (!ADMIN_API_KEY) {
        throw new Error('ADMIN_API_KEY environment variable is not set');
      }

      console.log(`[RIO-LATEST] ${method} ${endpoint} (attempt ${attempt}/${retries})`);
      const response = await axios(config);
      return response.data;
    } catch (error) {
      const message = error.response?.data || error.message;
      console.error(`[RIO-LATEST ERROR] ${method} ${endpoint} failed on attempt ${attempt}:`, message);
      if (attempt === retries) throw error;
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`[RIO-LATEST] Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}

// Job lock helpers
function getLockOwner() {
  const origin = process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local';
  return process.env.JOB_LOCK_OWNER || `${origin}:rio-latest:${process.pid}`;
}

async function acquireJobLock(ttlSeconds = undefined) {
  try {
    const body = { lock_name: LOCK_NAME, owner: getLockOwner(), job: 'rio-latest' };
    if (ttlSeconds) body.ttl_seconds = ttlSeconds;
    const resp = await makeRequest('POST', '/admin/job-lock/acquire', body, 1);
    console.log('[RIO-LATEST] Acquired job lock');
    HAS_LOCK = true;
    return { acquired: true, lock: resp.lock || resp };
  } catch (err) {
    const data = err.response?.data;
    if (data && data.status === 'LOCKED') {
      console.log(`[RIO-LATEST] Job lock is held by owner ${data.current?.owner} until ${data.current?.expires_at}`);
      return { acquired: false, current: data.current };
    }
    throw err;
  }
}

async function releaseJobLock() {
  try {
    if (!HAS_LOCK) return;
    await makeRequest('POST', '/admin/job-lock/release', { lock_name: LOCK_NAME, owner: getLockOwner() }, 1);
    HAS_LOCK = false;
    console.log('[RIO-LATEST] Released job lock');
  } catch (err) {
    console.warn('[RIO-LATEST] Failed to release job lock (it may have expired or been taken over):', err.response?.data || err.message);
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
  process.on('SIGINT', () => { console.log('[RIO-LATEST] Caught SIGINT'); gracefulExit(130); });
  process.on('SIGTERM', () => { console.log('[RIO-LATEST] Caught SIGTERM'); gracefulExit(143); });
  process.on('uncaughtException', async (err) => { console.error('[RIO-LATEST] Uncaught exception:', err); await gracefulExit(1); });
  process.on('unhandledRejection', async (reason) => { console.error('[RIO-LATEST] Unhandled rejection:', reason); await gracefulExit(1); });
}

// Fetch Raider.IO static-data for a given expansion id
async function fetchStaticData(expansionId) {
  const endpoint = `/raiderio/static-data?expansion_id=${expansionId}`;
  return await makeRequest('GET', endpoint);
}

function extractSeasonNumber(slug) {
  // slug format: season-<expansion>-<number>
  const match = /^season-[a-z0-9]+-(\d+)$/i.exec(String(slug));
  if (!match) return null;
  return Number(match[1]);
}

async function getMainSeasonCandidatesSorted() {
  console.log(`[RIO-LATEST] Determining latest main season candidates from expansions: ${EXPANSIONS.join(',')}`);
  const candidates = [];
  for (const expId of EXPANSIONS) {
    try {
      const data = await fetchStaticData(expId);
      const seasons = Array.isArray(data?.seasons) ? data.seasons : [];
      for (const s of seasons) {
        const slug = s?.slug ? String(s.slug) : null;
        if (!slug) continue;
        const isCanonical = /^season-[a-z0-9]+-\d+$/i.test(slug);
        if (!isCanonical) continue;
        const number = extractSeasonNumber(slug);
        if (!Number.isFinite(number)) continue;
        candidates.push({ slug, expansionId: expId, number });
      }
    } catch (e) {
      console.warn(`[RIO-LATEST] Failed to load static-data for expansion ${expId}: ${e.message}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error('No main seasons found from Raider.IO static-data');
  }

  candidates.sort((a, b) => {
    if (a.expansionId !== b.expansionId) return b.expansionId - a.expansionId;
    return b.number - a.number;
  });

  return candidates.map(c => c.slug);
}

async function rebuildCutoff(season, region, opts = {}) {
  const params = new URLSearchParams();
  params.set('season', season);
  params.set('region', region);
  if (opts.strict === true) params.set('strict', 'true');
  if (Number.isFinite(opts.max_pages)) params.set('max_pages', String(opts.max_pages));
  if (Number.isFinite(opts.stall_pages)) params.set('stall_pages', String(opts.stall_pages));
  if (opts.include_players === true) params.set('include_players', 'true');
  if (opts.dungeon_all === true) params.set('dungeon_all', 'true');
  if (opts.overscan === true) params.set('overscan', 'true');
  const endpoint = `/admin/raiderio/rebuild-top-cutoff?${params.toString()}`;
  return await makeRequest('POST', endpoint, {});
}

async function syncRaiderioStaticLatestExpansion() {
  const latestExpansionId = EXPANSIONS.length > 0 ? Math.max(...EXPANSIONS) : 10;
  console.log(`[RIO-LATEST] Syncing Raider.IO static data for latest expansion ${latestExpansionId}`);
  const endpoint = `/admin/raiderio/sync-static?expansion_id=${latestExpansionId}`;
  return await makeRequest('POST', endpoint, {});
}

async function runLatestCutoffsJob() {
  const startTime = new Date();
  console.log(`[RIO-LATEST] Starting Raider.IO latest cutoffs job at ${startTime.toISOString()}`);
  console.log(`[RIO-LATEST] API Base URL: ${API_BASE_URL}`);

  try {
    const lock = await acquireJobLock();
    if (!lock.acquired) {
      return { status: 'skipped', reason: 'Another job is running', holder: lock.current };
    }

    console.log('\n=== STEP 0: Sync Raider.IO static data (latest expansion only) ===');
    try {
      const syncResult = await syncRaiderioStaticLatestExpansion();
      console.log('[RIO-LATEST] Static data sync result:', JSON.stringify(syncResult));
    } catch (e) {
      console.warn('[RIO-LATEST] Static data sync failed (continuing):', e.response?.data || e.message);
    }

    const seasonCandidates = await getMainSeasonCandidatesSorted();
    let selectedSeason = null;
    let seasonAttemptIndex = 0;
    let aggregateRegionResults = [];

    while (seasonAttemptIndex < seasonCandidates.length && !selectedSeason) {
      const seasonSlug = seasonCandidates[seasonAttemptIndex++];
      console.log(`[RIO-LATEST] Trying season ${seasonSlug}`);

      const seasonRegionResults = [];
      let successCount = 0;
      for (const region of REGIONS) {
        try {
          console.log(`[RIO-LATEST] Rebuilding cutoff for ${seasonSlug} ${region}`);
          const resp = await rebuildCutoff(seasonSlug, region, {
            strict: getEnvBool(['RIO_STRICT', 'BACKFILL_STRICT'], false),
            max_pages: getEnvNumber(['RIO_MAX_PAGES', 'BACKFILL_MAX_PAGES']),
            stall_pages: getEnvNumber(['RIO_STALL_PAGES', 'BACKFILL_STALL_PAGES']),
            include_players: getEnvBool(['RIO_INCLUDE_PLAYERS', 'BACKFILL_INCLUDE_PLAYERS'], false),
            dungeon_all: getEnvBool(['RIO_DUNGEON_ALL', 'BACKFILL_DUNGEON_ALL'], false),
            overscan: getEnvBool(['RIO_OVERSCAN', 'BACKFILL_OVERSCAN'], false)
          });
          console.log(`[RIO-LATEST] ✓ ${seasonSlug} ${region} snapshot=${resp.snapshotId} qualifying=${resp.totalQualifying}`);
          seasonRegionResults.push({ region, status: 'success', snapshotId: resp.snapshotId, totalQualifying: resp.totalQualifying });
          successCount += 1;
          await sleep(500);
        } catch (e) {
          const status = e?.response?.status;
          const msg = e?.response?.data || e.message;
          console.warn(`[RIO-LATEST] ✗ ${seasonSlug} ${region} error:`, msg);
          if (status === 404) {
            console.warn(`[RIO-LATEST] Cutoffs not available for ${seasonSlug} ${region}`);
          }
          seasonRegionResults.push({ region, status: 'error', error: typeof msg === 'string' ? msg : JSON.stringify(msg) });
        }
      }

      if (successCount > 0) {
        selectedSeason = seasonSlug;
        aggregateRegionResults = seasonRegionResults;
      } else {
        console.log(`[RIO-LATEST] No regions had available cutoffs for ${seasonSlug}. Trying previous season if available...`);
      }
    }

    if (!selectedSeason) {
      throw new Error('No available seasons with cutoffs found');
    }

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    console.log(`[RIO-LATEST] Selected season ${selectedSeason}. Completed at ${endTime.toISOString()} in ${duration}s`);
    await releaseJobLock();
    return { status: 'success', season: selectedSeason, duration, results: aggregateRegionResults };
  } catch (error) {
    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;
    console.error(`[RIO-LATEST] Job failed at ${endTime.toISOString()} after ${duration}s`);
    console.error(`[RIO-LATEST] Error: ${error.message}`);
    await releaseJobLock();
    return { status: 'error', duration, error: error.message };
  }
}

if (require.main === module) {
  setupSignalHandlers();
  runLatestCutoffsJob()
    .then(result => {
      if (result.status === 'success' || result.status === 'skipped') {
        console.log('[RIO-LATEST] Job completed successfully');
        process.exit(0);
      } else {
        console.error('[RIO-LATEST] Job failed');
        process.exit(1);
      }
    })
    .catch(err => {
      console.error('[RIO-LATEST] Unexpected error:', err);
      process.exit(1);
    });
}

module.exports = { runLatestCutoffsJob };


