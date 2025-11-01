const express = require('express');
const proxyService = require('../services/proxy');
const db = require('../services/db');
const { getAllRegions } = require('../config/regions');
const fs = require('fs');
const path = require('path');
const { WOW_SPECIALIZATIONS, WOW_SPEC_ROLES, SEASON_METADATA, RAIDERIO_EXPANSION_IDS } = require('../config/constants');
const raiderIO = require('../services/raiderio/client');

// Try to import p-limit with error handling
let pLimit;
try {
  const pLimitModule = require('p-limit');
  pLimit = pLimitModule.default || pLimitModule;
} catch (error) {
  console.error('[ADMIN] Failed to import p-limit, using fallback:', error.message);
  // Fallback implementation
  pLimit = (concurrency) => {
    const queue = [];
    let active = 0;
    
    const next = () => {
      if (queue.length === 0) return;
      if (active >= concurrency) return;
      
      active++;
      const { fn, resolve, reject } = queue.shift();
      
      Promise.resolve().then(fn)
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          next();
        });
    };
    
    return (fn) => {
      return new Promise((resolve, reject) => {
        queue.push({ fn, resolve, reject });
        next();
      });
    };
  };
}

const { pipeline } = require('stream');
const { promisify } = require('util');
const copyFrom = require('pg-copy-streams').from;
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const adminAuthMiddleware = require('../middleware/admin-auth');

const router = express.Router();

// Apply admin authentication middleware to all routes
router.use(adminAuthMiddleware);

// In-memory job registry for long-running admin tasks
// Note: This is process-local and ephemeral; suitable for Render web service instances.
// Keys are job ids (uuid), values: { status: 'running'|'success'|'error', startedAt, finishedAt?, updatedAt?, result?, error?, code? }
const __adminJobRegistry = new Map();

// Basic TTL + max-size eviction to prevent unbounded growth
const JOB_REGISTRY_MAX = Number(process.env.ADMIN_JOB_REGISTRY_MAX || 200);
const JOB_REGISTRY_TTL_MS = Number(process.env.ADMIN_JOB_TTL_MS || 24 * 60 * 60 * 1000); // 24h default
const JOB_REGISTRY_SWEEP_MS = Number(process.env.ADMIN_JOB_CLEANUP_MS || 10 * 60 * 1000); // 10m default

function cleanupJobRegistry() {
  const now = Date.now();
  // 1) TTL-based removal for completed jobs
  for (const [id, entry] of __adminJobRegistry) {
    const finishedAt = entry.finishedAt ? Date.parse(entry.finishedAt) : null;
    const updatedAt = entry.updatedAt ? Date.parse(entry.updatedAt) : finishedAt || (entry.startedAt ? Date.parse(entry.startedAt) : null);
    const age = updatedAt ? (now - updatedAt) : 0;
    if ((entry.status === 'success' || entry.status === 'error') && JOB_REGISTRY_TTL_MS > 0 && age > JOB_REGISTRY_TTL_MS) {
      __adminJobRegistry.delete(id);
    }
  }

  // 2) Enforce max size: evict oldest completed jobs first, then oldest running only if still over cap
  if (__adminJobRegistry.size > JOB_REGISTRY_MAX) {
    const entries = Array.from(__adminJobRegistry.entries()).map(([id, e]) => {
      const ts = e.updatedAt || e.finishedAt || e.startedAt || new Date(0).toISOString();
      const isRunning = e.status === 'running';
      return { id, isRunning, ts: Date.parse(ts) || 0 };
    }).sort((a, b) => {
      // completed first (isRunning false), then by oldest timestamp
      if (a.isRunning !== b.isRunning) return a.isRunning ? 1 : -1;
      return a.ts - b.ts;
    });

    for (const item of entries) {
      if (__adminJobRegistry.size <= JOB_REGISTRY_MAX) break;
      // skip running until only running remain
      if (item.isRunning) continue;
      __adminJobRegistry.delete(item.id);
    }

    // If still over cap, evict oldest running
    if (__adminJobRegistry.size > JOB_REGISTRY_MAX) {
      for (const item of entries) {
        if (__adminJobRegistry.size <= JOB_REGISTRY_MAX) break;
        __adminJobRegistry.delete(item.id);
      }
    }
  }
}

setInterval(() => {
  try { cleanupJobRegistry(); } catch (e) { console.warn('[ADMIN] job registry cleanup error:', e.message); }
}, JOB_REGISTRY_SWEEP_MS);

// Test endpoint for admin authentication
router.get('/test', (req, res) => {
  console.log(`🔐 [ADMIN] GET /admin/test`);
  res.json({
    success: true,
    message: 'Admin authentication successful',
    timestamp: new Date().toISOString()
  });
});

// Import the automation functions
// Note: render-automation script removed; wire these to existing jobs or service endpoints as needed
const automation = {
  runDailyAutomation: async () => ({ status: 'success', message: 'stubbed' }),
  fetchLeaderboardData: async () => ({ status: 'stubbed' }),
  importLeaderboardData: async () => ({ status: 'stubbed' }),
  cleanupLeaderboard: async () => ({ status: 'stubbed' }),
  refreshViews: async () => ({ status: 'stubbed' })
};

// --- POPULATE FUNCTIONS ---
// Create Raider.IO static tables if not exist
async function ensureRaiderioStaticTables() {
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS raiderio_dungeon (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE,
      name TEXT NOT NULL,
      short_name TEXT,
      expansion_id INTEGER
    );
  `);
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS raiderio_season (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      expansion_id INTEGER,
      start_ts TIMESTAMPTZ,
      end_ts TIMESTAMPTZ
    );
  `);
}

// Core function: sync Raider.IO static data for one or many expansions
async function syncRaiderioStatic(expansionIdOrAll = 'all') {
  await ensureRaiderioStaticTables();
  const allIds = Object.values(RAIDERIO_EXPANSION_IDS).filter(Number.isFinite);
  const targetIds = String(expansionIdOrAll).toLowerCase() === 'all'
    ? allIds
    : [Number(expansionIdOrAll)].filter(n => Number.isFinite(n));

  const summary = [];
  for (const expansion_id of targetIds) {
    const data = await raiderIO.getStaticData({ expansion_id });
    const dungeons = data?.dungeons || data?.mythic_plus_dungeons || [];
    const seasons = data?.seasons || [];

    let dungeonUpserts = 0;
    for (const d of dungeons) {
      const payload = {
        id: d?.id,
        slug: d?.slug || d?.short_name || String(d?.id || ''),
        name: d?.name || d?.display_name || d?.slug,
        short_name: d?.short_name || null,
        expansion_id,
      };
      if (payload.id && payload.name) {
        await db.upsertRaiderioDungeon(payload);
        dungeonUpserts += 1;
      }
    }

    let seasonUpserts = 0;
    for (const s of seasons) {
      const payload = {
        slug: s?.slug || s?.name,
        name: s?.name || s?.slug,
        expansion_id,
        start_ts: s?.starts?.us ? new Date(s.starts.us) : (s?.start_timestamp ? new Date(s.start_timestamp) : null),
        end_ts: s?.ends?.us ? new Date(s.ends.us) : (s?.end_timestamp ? new Date(s.end_timestamp) : null),
      };
      if (payload.slug) {
        await db.upsertRaiderioSeason(payload);
        seasonUpserts += 1;
      }
    }

    summary.push({ expansion_id, dungeonUpserts, seasonUpserts });
  }
  return { ok: true, expansions: summary };
}

// Admin route: sync Raider.IO static data (supports ?expansion_id=all)
router.post('/raiderio/sync-static', async (req, res, next) => {
  try {
    const expansion = req.query.expansion_id || 'all';
    const result = await syncRaiderioStatic(expansion);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Admin route: rebuild top 0.1% snapshot and persist
// POST /admin/raiderio/rebuild-top-cutoff
//
// Query parameters:
// - season (string, required): Raider.IO season slug, e.g. 'season-df-4', 'season-tww-2'.
// - region (string, optional, default 'us'): One of 'us', 'eu', 'kr', 'tw'.
// - strict (boolean, optional, default false):
//     - false: stop early when qualifiers found >= targetCount (quantilePopulationCount from cutoffs).
//     - true: ignore targetCount and crawl deeply, stopping only by stall_pages or max_pages caps.
// - max_pages (integer, optional, default 40):
//     - Per-dungeon page cap when crawling runs (or for the unified feed when dungeon_all=true).
// - stall_pages (integer, optional, default 50):
//     - Strict mode only. Per-dungeon threshold of consecutive pages that add zero new qualifiers;
//       once reached, we stop crawling that dungeon early.
// - include_players (boolean, optional, default false):
//     - When true, also persist each qualifying player into 'raiderio_cutoff_player'.
//       When false, only the aggregate class/spec 'distribution' is stored in the snapshot.
// - dungeon_all (boolean, optional, default false):
//     - When true, use 'dungeon=all' on /mythic-plus/runs instead of iterating season dungeons.
//       This consolidates discovery into a single run feed.
// - overscan (boolean, optional, default false):
//     - Strict mode only. When enabled, once we reach max_pages we continue fetching
//       as long as the per-dungeon stall condition has not triggered (i.e.,
//       consecutive no-new-qualifier pages < stall_pages).
//
// Notes:
// - We obtain 'cutoffScore' and 'targetCount' from /api/v1/mythic-plus/season-cutoffs.
// - We resolve season dungeons via /api/v1/mythic-plus/static-data (prefer the season's own list).
// - Character profile checks use fields='mythic_plus_scores_by_season:<season>'.
// - Concurrency and pacing are conservative to respect Raider.IO rate limits; transient 429/5xx
//   responses are retried with backoff. Distribution is computed from the deduplicated qualifiers set.
async function rebuildTopCutoffInternal({ season, region, strictMode, maxPagesPerDungeon, stallPagesThreshold, includePlayers, useDungeonAll, overscanMode }) {
  if (!season) {
    const e = new Error('Missing required query param: season');
    e.status = 400;
    throw e;
  }

  await db.ensureRaiderioCutoffTables();

  // 1) cutoff and target
  let cutoffs;
  try {
    cutoffs = await raiderIO.getSeasonCutoffs({ season, region });
  } catch (e) {
    const status = e?.response?.status;
    if (status === 404) {
      const err = new Error(`Cutoffs not available for season ${season} in region ${region}`);
      err.status = 404;
      throw err;
    }
    throw e;
  }
  const cutoffScore = cutoffs?.cutoffs?.p999?.all?.quantileMinValue ?? null;
  const targetCount = cutoffs?.cutoffs?.p999?.all?.quantilePopulationCount ?? null;
  if (cutoffScore == null) {
    const e = new Error('Failed to resolve 0.1% cutoff score from Raider.IO payload');
    e.status = 502;
    throw e;
  }

  // 2) dungeons for season from static-data
  // Pick expansion from season slug
  let expansion_id = RAIDERIO_EXPANSION_IDS.THE_WAR_WITHIN;
  if (typeof season === 'string') {
    const s = season.toLowerCase();
    if (s.includes('-df-')) expansion_id = RAIDERIO_EXPANSION_IDS.DRAGONFLIGHT;
    else if (s.includes('-sl-')) expansion_id = RAIDERIO_EXPANSION_IDS.SHADOWLANDS;
    else if (s.includes('-bfa-')) expansion_id = RAIDERIO_EXPANSION_IDS.BFA;
    else if (s.includes('-tww-')) expansion_id = RAIDERIO_EXPANSION_IDS.THE_WAR_WITHIN;
  }
  const staticData = await raiderIO.getStaticData({ expansion_id });
  const seasonBlock = (staticData?.seasons || []).find(s => s?.slug === season) || {};
  let seasonDungeons = Array.isArray(seasonBlock?.dungeons) ? seasonBlock.dungeons : [];
  if (seasonDungeons.length === 0) {
    // Rely on static source only; if season block lacks dungeons, use expansion-wide list
    seasonDungeons = staticData?.dungeons || [];
  }
  const dungeonSlugs = useDungeonAll ? ['all'] : seasonDungeons.map(d => d.slug).filter(Boolean);

  // 3) crawl runs
  const seen = new Set();
  const qualifying = new Map();
  let pagesFetched = 0;

  const profileLimit = pLimit(4);
  async function fetchRunsForDungeon(slug) {
    let noNewPagesInRow = 0; // per-dungeon stall counter
    let page = 0;
    let allowBeyondCap = false; // enable continuing past max_pages when overscan is active and stall not reached
    while (true) {
      if (!allowBeyondCap && page >= maxPagesPerDungeon) break;
      const beforePageCount = qualifying.size;
      let resp;
      // per-page retry loop for transient errors
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          resp = await raiderIO.getTopRuns({ season, region, dungeon: slug, page });
          break;
        } catch (e) {
          const status = e?.response?.status;
          if (status === 429) {
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          if (status === 502 || status === 503 || status === 504) {
            // exponential backoff for gateway/server errors
            await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          if (attempt === 2) {
            // Give up this page and proceed; do not fail entire job
            resp = null;
          }
        }
      }
      const rankings = resp?.rankings || [];
      if (!Array.isArray(rankings) || rankings.length === 0) break;
      pagesFetched++;
      for (const r of rankings) {
        const roster = r?.run?.roster || [];
        for (const m of roster) {
          const c = m?.character || m;
          const realm = c?.realm?.slug || c?.realm?.name || c?.realm;
          const name = c?.name || c?.character?.name;
          if (!realm || !name) continue;
          const key = `${region}:${String(realm).toLowerCase()}:${String(name).toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // fetch profile to confirm score with limited concurrency
          await profileLimit(async () => {
            try {
              // Request scores for the specific season being processed
              const fields = `mythic_plus_scores_by_season:${season}`;
              const profile = await raiderIO.getCharacterProfile({ region, realm, name, fields });

              // Find the season entry matching the requested season
              const scoresBySeason = profile?.mythic_plus_scores_by_season || [];
              const seasonEntry = scoresBySeason.find(s => s?.season === season || s?.season?.slug === season) || scoresBySeason[0];

              const score = seasonEntry?.scores?.all
                ?? seasonEntry?.segments?.all?.score
                ?? null;

              if (typeof score === 'number' && score >= cutoffScore) {
                const className = c?.class?.name || m?.class || 'Unknown';
                const specName = c?.spec?.name || m?.spec || 'Unknown';
                qualifying.set(key, { region, realm_slug: String(realm).toLowerCase(), name: String(name), class: className, spec: specName, score });
              }
            } catch (_) { /* ignore */ }
          });
        }
      }
      // Update global stall counter
      const addedThisPage = qualifying.size - beforePageCount;
      if (addedThisPage <= 0) {
        noNewPagesInRow++;
      } else {
        noNewPagesInRow = 0;
      }
      if (strictMode) {
        // If overscan is enabled and we're at/over the cap but have not hit stall yet,
        // permit continuing beyond the cap regardless of whether the boundary page added qualifiers.
        if (overscanMode && !allowBeyondCap && page + 1 >= maxPagesPerDungeon && noNewPagesInRow < stallPagesThreshold) {
          allowBeyondCap = true;
        }
        if (noNewPagesInRow >= stallPagesThreshold) break; // stop this dungeon early
      } else if (typeof targetCount === 'number' && qualifying.size >= targetCount) {
        break;
      }
      // gentle pacing between pages
      await new Promise(r => setTimeout(r, 300));
      page += 1;
    }
  }

  // limit parallel dungeons
  const dungeonLimit = pLimit(strictMode ? 1 : 2);
  const tasks = dungeonSlugs.map(slug => dungeonLimit(() => fetchRunsForDungeon(slug)));
  await Promise.all(tasks);

  // 4) distribution and persist
  const distribution = {};
  for (const p of qualifying.values()) {
    if (!distribution[p.class]) distribution[p.class] = { total: 0, specs: {} };
    if (!distribution[p.class].specs[p.spec]) distribution[p.class].specs[p.spec] = 0;
    distribution[p.class].total += 1;
    distribution[p.class].specs[p.spec] += 1;
  }

  const snapshotId = await db.insertCutoffSnapshot({
    season_slug: season,
    region,
    cutoff_score: cutoffScore,
    target_count: targetCount,
    total_qualifying: qualifying.size,
    source_pages: pagesFetched,
    dungeon_count: dungeonSlugs.length,
    distribution
  });
  if (includePlayers) {
    await db.bulkInsertCutoffPlayers(snapshotId, Array.from(qualifying.values()));
  }

  return { ok: true, snapshotId, season, region, cutoffScore, targetCount, totalQualifying: qualifying.size, distribution, playersPersisted: includePlayers };
}

// Synchronous route (existing behavior)
router.post('/raiderio/rebuild-top-cutoff', async (req, res, next) => {
  try {
    const { season } = req.query;
    const region = (req.query.region || 'us').toLowerCase();
    const strictMode = String(req.query.strict || 'false').toLowerCase() === 'true';
    const maxPagesPerDungeon = Number.isFinite(Number(req.query.max_pages)) ? Number(req.query.max_pages) : 40;
    const stallPagesThreshold = Number.isFinite(Number(req.query.stall_pages)) ? Number(req.query.stall_pages) : 50;
    const includePlayers = String(req.query.include_players || 'false').toLowerCase() === 'true';
    const useDungeonAll = String(req.query.dungeon_all || 'false').toLowerCase() === 'true';
    const overscanMode = strictMode && String(req.query.overscan || 'false').toLowerCase() === 'true';

    const result = await rebuildTopCutoffInternal({ season, region, strictMode, maxPagesPerDungeon, stallPagesThreshold, includePlayers, useDungeonAll, overscanMode });
    res.json(result);
  } catch (err) {
    const status = err?.status || 500;
    if (!res.headersSent) res.status(status);
    next(err);
  }
});

// Async variant to avoid Render proxy timeouts for long-running operations
router.post('/raiderio/rebuild-top-cutoff-async', async (req, res) => {
  const { season } = req.query;
  const region = (req.query.region || 'us').toLowerCase();
  const strictMode = String(req.query.strict || 'false').toLowerCase() === 'true';
  const maxPagesPerDungeon = Number.isFinite(Number(req.query.max_pages)) ? Number(req.query.max_pages) : 40;
  const stallPagesThreshold = Number.isFinite(Number(req.query.stall_pages)) ? Number(req.query.stall_pages) : 50;
  const includePlayers = String(req.query.include_players || 'false').toLowerCase() === 'true';
  const useDungeonAll = String(req.query.dungeon_all || 'false').toLowerCase() === 'true';
  const overscanMode = strictMode && String(req.query.overscan || 'false').toLowerCase() === 'true';

  const jobId = uuidv4();
  __adminJobRegistry.set(jobId, { status: 'running', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

  // Kick off background task
  (async () => {
    try {
      const result = await rebuildTopCutoffInternal({ season, region, strictMode, maxPagesPerDungeon, stallPagesThreshold, includePlayers, useDungeonAll, overscanMode });
      __adminJobRegistry.set(jobId, { status: 'success', startedAt: __adminJobRegistry.get(jobId)?.startedAt, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), result });
    } catch (error) {
      __adminJobRegistry.set(jobId, { status: 'error', startedAt: __adminJobRegistry.get(jobId)?.startedAt, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: error.message, code: error.status || 500 });
    } finally {
      // Opportunistic cleanup after each job completes
      try { cleanupJobRegistry(); } catch (_) {}
    }
  })();

  res.json({ status: 'OK', job_id: jobId, note: 'Use GET /admin/raiderio/rebuild-top-cutoff-status?job_id=...' });
});

router.get('/raiderio/rebuild-top-cutoff-status', async (req, res) => {
  const jobId = req.query.job_id;
  if (!jobId) return res.status(400).json({ error: true, message: 'Missing job_id' });
  const entry = __adminJobRegistry.get(jobId);
  if (!entry) return res.status(404).json({ error: true, message: 'Job not found' });
  res.json(entry);
});
async function populateDungeons() {
  const region = 'us';
  const resp = await proxyService.getGameData('mythic-keystone-dungeons', region, {});
  const dungeons = resp.data.dungeons || [];
  let inserted = 0, failed = 0;
  for (const d of dungeons) {
    const result = await db.pool.query(
      'INSERT INTO dungeon (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
      [d.id, d.name]
    );
    if (result.rowCount > 0) inserted++; else failed++;
  }
  return { status: failed === 0 ? 'OK' : 'NOT OK', inserted, failed };
}

async function populateSeasons() {
  const region = 'us';
  const resp = await proxyService.getGameData('mythic-keystone-seasons', region, {});
  const seasons = resp.data.seasons || [];
  let inserted = 0, failed = 0;
  for (const s of seasons) {
    const id = s.id;
    const constantsName = (SEASON_METADATA && SEASON_METADATA[id] && SEASON_METADATA[id].name) ? SEASON_METADATA[id].name : null;
    const apiName = s.name && String(s.name).trim() !== '' ? s.name : null;
    const name = constantsName || apiName || `Season ${id}`;

    // Try to get start/end timestamps from the season detail endpoint
    let startDate = null;
    let endDate = null;
    try {
      const detail = await proxyService.getGameData('mythic-keystone-season', region, { id });
      const startTs = detail?.data?.start_timestamp;
      const endTs = detail?.data?.end_timestamp;
      if (typeof startTs === 'number' && Number.isFinite(startTs)) {
        startDate = new Date(startTs).toISOString().slice(0, 10); // YYYY-MM-DD
      }
      if (typeof endTs === 'number' && Number.isFinite(endTs)) {
        endDate = new Date(endTs).toISOString().slice(0, 10);
      }
    } catch (e) {
      // If detail call fails, leave dates null
    }

    const result = await db.pool.query(
      `INSERT INTO season (id, name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, start_date = COALESCE(EXCLUDED.start_date, season.start_date), end_date = COALESCE(EXCLUDED.end_date, season.end_date)`,
      [id, name, startDate, endDate]
    );
    if (result.rowCount > 0) inserted++; else failed++;
  }
  return { status: failed === 0 ? 'OK' : 'NOT OK', inserted, failed };
}

async function populatePeriods() {
  const region = 'us';
  const seasonsResp = await proxyService.getGameData('mythic-keystone-seasons', region, {});
  const seasons = seasonsResp.data.seasons || [];
  let inserted = 0, failed = 0;
  for (const s of seasons) {
    const seasonId = s.id;
    const seasonResp = await proxyService.getGameData('mythic-keystone-season', region, { id: seasonId });
    const periods = seasonResp.data.periods || [];
    for (const p of periods) {
      const href = p && p.key && p.key.href;
      let periodId = null;
      if (href) {
        const match = href.match(/period\/(\d+)/);
        periodId = match ? parseInt(match[1], 10) : null;
      }
      if (periodId) {
        // Fetch period details to capture start/end timestamps
        let startDate = null;
        let endDate = null;
        try {
          const detail = await proxyService.getGameData('mythic-keystone-period', region, { id: periodId });
          const startTs = detail?.data?.start_timestamp;
          const endTs = detail?.data?.end_timestamp;
          if (typeof startTs === 'number' && Number.isFinite(startTs)) {
            startDate = new Date(startTs).toISOString().slice(0, 10);
          }
          if (typeof endTs === 'number' && Number.isFinite(endTs)) {
            endDate = new Date(endTs).toISOString().slice(0, 10);
          }
        } catch (e) {
          // silent fallback; leave dates null
        }
        const result = await db.pool.query(
          `INSERT INTO period (id, season_id, start_date, end_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET 
             season_id = EXCLUDED.season_id,
             start_date = COALESCE(EXCLUDED.start_date, period.start_date),
             end_date = COALESCE(EXCLUDED.end_date, period.end_date)`,
          [periodId, seasonId, startDate, endDate]
        );
        if (result.rowCount > 0) inserted++; else failed++;
      }
    }
  }
  return { status: failed === 0 ? 'OK' : 'NOT OK', inserted, failed };
}

async function populateRealms() {
  const regions = ['us', 'eu', 'kr', 'tw'];
  let inserted = 0, failed = 0, regionErrors = 0;
  for (const region of regions) {
    try {
      const resp = await proxyService.getGameData('connected-realms-index', region, {});
      const connectedRealms = resp.data.connected_realms || [];
      for (const obj of connectedRealms) {
        const match = obj.href.match(/connected-realm\/(\d+)/);
        const id = match ? parseInt(match[1], 10) : null;
        if (id) {
          const name = `Realm ${id}`;
          const result = await db.pool.query(
            'INSERT INTO realm (id, name, region) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, region = EXCLUDED.region',
            [id, name, region]
          );
          if (result.rowCount > 0) inserted++; else failed++;
        }
      }
    } catch (err) {
      regionErrors++;
      console.warn(`Warning: Failed to populate realms for region ${region}: ${err.message}`);
      continue;
    }
  }
  if (regionErrors === regions.length) {
    throw new Error('Failed to populate realms for all regions');
  }
  return { status: failed === 0 ? 'OK' : 'NOT OK', inserted, failed, regionErrors };
}

// Helper for batch insert (copied from wow.js)
function dedupeGroupMembers(members) {
  const seen = new Set();
  return members.filter(m => {
    const key = `${m.group_id}|${m.character_name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function batchInsertLeaderboardRuns(runs, client, batchSize = 500) {
  for (let i = 0; i < runs.length; i += batchSize) {
    const batch = runs.slice(i, i + batchSize);
    if (batch.length === 0) continue;
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const run of batch) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(
        run.dungeon_id, run.period_id, run.realm_id, run.season_id, run.region,
        run.completed_at, run.duration_ms, run.keystone_level, run.score, run.rank, run.group_id
      );
    }
    await client.query(
      `INSERT INTO leaderboard_run
        (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level, score, rank, group_id)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level)
       DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, group_id = EXCLUDED.group_id;`,
      values
    );
  }
}
async function batchInsertGroupMembers(members, client, batchSize = 500) {
  for (let i = 0; i < members.length; i += batchSize) {
    let batch = members.slice(i, i + batchSize);
    batch = dedupeGroupMembers(batch);
    if (batch.length === 0) continue;
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const m of batch) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(m.group_id, m.character_name, m.class_id, m.spec_id, m.role);
    }
    await client.query(
      `INSERT INTO group_member (group_id, character_name, class_id, spec_id, role)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (group_id, character_name) DO UPDATE SET
         class_id = EXCLUDED.class_id,
         spec_id = EXCLUDED.spec_id,
         role = EXCLUDED.role;`,
      values
    );
  }
}

// Helper to deduplicate run_group_member batch by (run_id, character_name)
function dedupeRunGroupMembers(members) {
  const seen = new Set();
  return members.filter(([runId, characterName]) => {
    const key = `${runId}|${characterName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// --- HTTP ENDPOINTS ---
router.post('/populate-dungeons', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/populate-dungeons`);
  try {
    const result = await populateDungeons();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-seasons', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/populate-seasons`);
  try {
    const result = await populateSeasons();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-periods', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/populate-periods`);
  try {
    const result = await populatePeriods();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-realms', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/populate-realms`);
  try {
    const result = await populateRealms();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/populate-all-parallel - Run all populate functions in parallel
router.post('/populate-all-parallel', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/populate-all-parallel`);
  try {
    const startTime = Date.now();
    
    // Run all populate functions in parallel
    const [dungeonsResult, seasonsResult, periodsResult, realmsResult] = await Promise.allSettled([
      populateDungeons(),
      populateSeasons(),
      populatePeriods(),
      populateRealms()
    ]);

    const duration = Date.now() - startTime;
    
    // Process results
    const results = {
      dungeons: dungeonsResult.status === 'fulfilled' ? dungeonsResult.value : { status: 'ERROR', error: dungeonsResult.reason.message },
      seasons: seasonsResult.status === 'fulfilled' ? seasonsResult.value : { status: 'ERROR', error: seasonsResult.reason.message },
      periods: periodsResult.status === 'fulfilled' ? periodsResult.value : { status: 'ERROR', error: periodsResult.reason.message },
      realms: realmsResult.status === 'fulfilled' ? realmsResult.value : { status: 'ERROR', error: realmsResult.reason.message }
    };

    // Count successes and failures
    const successful = Object.values(results).filter(r => r.status === 'OK').length;
    const failed = Object.values(results).filter(r => r.status === 'ERROR').length;

    res.json({
      status: failed === 0 ? 'OK' : 'PARTIAL',
      message: `Parallel population completed in ${duration}ms`,
      duration_ms: duration,
      successful,
      failed,
      results
    });

  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// Helper to print a progress bar for file import
function printFileImportProgress(current, total) {
  const percent = ((current / total) * 100).toFixed(1);
  const barLength = 20;
  const filled = Math.round((current / total) * barLength);
  const bar = '[' + '#'.repeat(filled) + '-'.repeat(barLength - filled) + ']';
  console.log(`[IMPORT ALL] Progress: ${bar} ${current}/${total} files (${percent}%)`);
}
// --- Admin import all endpoint ---
router.post('/import-all-leaderboard-json', async (req, res) => {
  console.log(`🔐 [ADMIN] POST /admin/import-all-leaderboard-json`);
  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
    }
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }
    
    console.log(`[IMPORT ALL] Starting bulk import for ${files.length} files...`);
    let totalRuns = 0;
    let totalMembers = 0;
    let results = [];
    
    // Use a single connection pool with higher limits
    const pool = db.pool;
    const limit = pLimit(4); // Reduced from 8 to 4 for better memory management
    let completed = 0;
    const totalFiles = files.length;
    
    const fileTasks = files.map(filename => limit(async () => {
      const filePath = path.join(outputDir, filename);
      const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const client = await pool.connect();
      let inserted = 0;
      
      try {
        await client.query('BEGIN');
        
        // Create temporary tables for this file's processing
        await client.query(`
          CREATE TEMP TABLE temp_leaderboard_runs (
            region VARCHAR(8),
            season_id INTEGER,
            period_id INTEGER,
            dungeon_id INTEGER,
            realm_id INTEGER,
            completed_at TIMESTAMP,
            duration_ms INTEGER,
            keystone_level INTEGER,
            score DOUBLE PRECISION,
            rank INTEGER,
            run_guid UUID
          ) ON COMMIT DROP;
        `);
        
        await client.query(`
          CREATE TEMP TABLE temp_run_group_members (
            run_guid UUID,
            character_name VARCHAR(64),
            class_id INTEGER,
            spec_id INTEGER,
            role VARCHAR(16)
          ) ON COMMIT DROP;
        `);
        
        // 1. Bulk insert runs into temporary table using COPY
        const runsCsvPath = path.join(os.tmpdir(), `runs-${filename}-${Date.now()}.csv`);
        const runsCsv = fs.createWriteStream(runsCsvPath);
        
        for (const run of runs) {
          runsCsv.write([
            run.region,
            run.season_id,
            run.period_id,
            run.dungeon_id,
            run.realm_id,
            run.completed_at,
            run.duration_ms,
            run.keystone_level,
            run.score,
            run.rank,
            run.run_guid
          ].map(x => x === undefined ? '' : x).join(',') + '\n');
        }
        runsCsv.end();
        
        // Wait for file to be written and check it exists
        await new Promise((resolve, reject) => {
          runsCsv.on('finish', resolve);
          runsCsv.on('error', reject);
        });
        
        // Verify file exists before proceeding
        if (!fs.existsSync(runsCsvPath)) {
          throw new Error(`Failed to create temporary file: ${runsCsvPath}`);
        }
        
        await new Promise((resolve, reject) => {
          const stream = client.query(copyFrom(`COPY temp_leaderboard_runs FROM STDIN WITH (FORMAT csv)`));
          const fileStream = fs.createReadStream(runsCsvPath);
          pipeline(fileStream, stream, err => err ? reject(err) : resolve());
        });
        
        // 2. Insert runs from temp table to main table with conflict resolution
        await client.query(`
          INSERT INTO leaderboard_run (region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid)
          SELECT region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid
          FROM temp_leaderboard_runs
          ON CONFLICT (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
          DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, realm_id = EXCLUDED.realm_id;
        `);
        
        // 3. Get successful run_guids for member insertion
        const { rows } = await client.query(
          'SELECT run_guid FROM leaderboard_run WHERE run_guid IN (SELECT run_guid FROM temp_leaderboard_runs)'
        );
        const successfulRunGuids = new Set(rows.map(r => r.run_guid));
        
        // 4. Bulk insert members into temporary table using COPY
        const membersCsvPath = path.join(os.tmpdir(), `members-${filename}-${Date.now()}.csv`);
        const membersCsv = fs.createWriteStream(membersCsvPath);
        
        let memberCount = 0;
        let unknownCount = 0;
        for (const run of runs) {
          if (run.members && run.members.length > 0 && successfulRunGuids.has(run.run_guid)) {
            for (const m of run.members) {
              // Use 'unknown' for null or empty character names
              const characterName = (!m.character_name || m.character_name.trim() === '') ? 'unknown' : m.character_name;
              if (characterName === 'unknown') {
                unknownCount++;
              }
              membersCsv.write([
                run.run_guid,
                characterName,
                m.class_id,
                m.spec_id,
                m.role
              ].map(x => x === undefined ? '' : x).join(',') + '\n');
              memberCount++;
            }
          }
        }
        if (unknownCount > 0) {
          console.log(`[IMPORT ALL] Used 'unknown' for ${unknownCount} members with null/empty character names`);
        }
        membersCsv.end();
        
        // Wait for file to be written and check it exists
        if (memberCount > 0) {
          await new Promise((resolve, reject) => {
            membersCsv.on('finish', resolve);
            membersCsv.on('error', reject);
          });
          
          // Verify file exists before proceeding
          if (!fs.existsSync(membersCsvPath)) {
            throw new Error(`Failed to create temporary file: ${membersCsvPath}`);
          }
        }
        
        if (memberCount > 0) {
          await new Promise((resolve, reject) => {
            const stream = client.query(copyFrom(`COPY temp_run_group_members FROM STDIN WITH (FORMAT csv)`));
            const fileStream = fs.createReadStream(membersCsvPath);
            pipeline(fileStream, stream, err => err ? reject(err) : resolve());
          });
          
          // 5. Insert members from temp table to main table with deduplication
          await client.query(`
            INSERT INTO run_group_member (run_guid, character_name, class_id, spec_id, role)
            SELECT DISTINCT ON (run_guid, character_name) run_guid, character_name, class_id, spec_id, role
            FROM temp_run_group_members
            ON CONFLICT (run_guid, character_name) DO UPDATE SET
              class_id = EXCLUDED.class_id,
              spec_id = EXCLUDED.spec_id,
              role = EXCLUDED.role;
          `);
        }
        
        await client.query('COMMIT');
        
        // Clean up temporary files
        try {
          fs.unlinkSync(runsCsvPath);
        } catch (err) {
          console.warn(`Warning: Could not delete temporary file ${runsCsvPath}:`, err.message);
        }
        if (memberCount > 0) {
          try {
            fs.unlinkSync(membersCsvPath);
          } catch (err) {
            console.warn(`Warning: Could not delete temporary file ${membersCsvPath}:`, err.message);
          }
        }
        
        return { filename, runs: runs.length, members: memberCount };
        
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[IMPORT ALL ERROR] File: ${filename}`, err);
        return { filename, error: err.message };
      } finally {
        client.release();
        completed++;
        printFileImportProgress(completed, totalFiles);
      }
    }));
    
    const settled = await Promise.allSettled(fileTasks);
    
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value && (result.value.runs || result.value.members)) {
        totalRuns += result.value.runs || 0;
        totalMembers += result.value.members || 0;
        results.push(result.value);
      } else if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ error: result.reason && result.reason.message });
      }
    }
    
    console.log(`[IMPORT ALL] Bulk import complete. Total runs: ${totalRuns}, total members: ${totalMembers}`);
    res.json({ status: 'OK', totalRuns, totalMembers, results });
    
  } catch (error) {
    console.error('[IMPORT ALL ERROR]', error);
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Optimized version of import-all endpoint for large datasets ---
router.post('/import-all-leaderboard-json-fast', async (req, res) => {
  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
    }
    // Gather and sort files for deterministic batching
    let files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json')).sort();
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }

    // Query-tunable knobs to keep requests under provider timeouts
    const BATCH_SIZE = Math.max(1, Math.min(parseInt(req.query.batch_size, 10) || 50, 500));
    const MAX_BATCHES = Math.max(1, Math.min(parseInt(req.query.max_batches, 10) || Math.ceil(files.length / BATCH_SIZE), 1000));
    const CONCURRENT_TASKS = Math.max(1, Math.min(parseInt(req.query.concurrency, 10) || 6, 16));
    const DELETE_PROCESSED = String(req.query.delete_processed || 'false').toLowerCase() === 'true';

    console.log(`[IMPORT ALL FAST] Starting optimized import for ${files.length} files (batch_size=${BATCH_SIZE}, max_batches=${MAX_BATCHES}, concurrency=${CONCURRENT_TASKS}, delete_processed=${DELETE_PROCESSED})`);

    let totalRuns = 0;
    let totalMembers = 0;
    let results = [];
    let batchesProcessed = 0;
    let processedFilesCount = 0;

    const pool = db.pool;
    const limit = pLimit(CONCURRENT_TASKS);

    // We will process up to MAX_BATCHES batches in this single HTTP request
    while (files.length > 0 && batchesProcessed < MAX_BATCHES) {
      const batchFiles = files.slice(0, BATCH_SIZE);
      const totalFilesThisRequest = Math.min(files.length, BATCH_SIZE * MAX_BATCHES);
      console.log(`[IMPORT ALL FAST] Processing batch ${batchesProcessed + 1}/${Math.ceil(totalFilesThisRequest / BATCH_SIZE)} (files: ${batchFiles.length})`);

      // Create batch CSVs
      const batchRunsCsvPath = path.join(os.tmpdir(), `batch-runs-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
      const batchMembersCsvPath = path.join(os.tmpdir(), `batch-members-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
      const batchRunsCsv = fs.createWriteStream(batchRunsCsvPath);
      const batchMembersCsv = fs.createWriteStream(batchMembersCsvPath);

      // Build CSVs concurrently from files
      let completed = 0;
      const totalFilesInBatch = batchFiles.length;
      const batchTasks = batchFiles.map(filename => limit(async () => {
        const filePath = path.join(outputDir, filename);
        let fileRuns = 0;
        let fileMembers = 0;
        try {
          const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          fileRuns = runs.length;
          for (const run of runs) {
            batchRunsCsv.write([
              run.region,
              run.season_id,
              run.period_id,
              run.dungeon_id,
              run.realm_id,
              run.completed_at,
              run.duration_ms,
              run.keystone_level,
              run.score,
              run.rank,
              run.run_guid
            ].map(x => x === undefined ? '' : x).join(',') + '\n');

            if (run.members && run.members.length > 0) {
              for (const m of run.members) {
                const characterName = (!m.character_name || m.character_name.trim() === '') ? 'unknown' : m.character_name;
                batchMembersCsv.write([
                  run.run_guid,
                  characterName,
                  m.class_id,
                  m.spec_id,
                  m.role
                ].map(x => x === undefined ? '' : x).join(',') + '\n');
                fileMembers++;
              }
            }
          }
          completed++;
          printFileImportProgress(completed, totalFilesInBatch);
          return { filename, runs: fileRuns, members: fileMembers };
        } catch (err) {
          console.error(`[IMPORT ALL FAST ERROR] File: ${filename}`, err);
          return { filename, error: err.message };
        }
      }));

      const batchResults = await Promise.allSettled(batchTasks);

      // Close CSV streams and wait for IO drain
      batchRunsCsv.end();
      batchMembersCsv.end();
      await Promise.all([
        new Promise(resolve => batchRunsCsv.on('finish', resolve)),
        new Promise(resolve => batchMembersCsv.on('finish', resolve))
      ]);

      // Copy into temp tables and merge in a single transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMP TABLE temp_leaderboard_runs (
            region VARCHAR(8),
            season_id INTEGER,
            period_id INTEGER,
            dungeon_id INTEGER,
            realm_id INTEGER,
            completed_at TIMESTAMP,
            duration_ms INTEGER,
            keystone_level INTEGER,
            score DOUBLE PRECISION,
            rank INTEGER,
            run_guid UUID
          ) ON COMMIT DROP;
        `);
        await client.query(`
          CREATE TEMP TABLE temp_run_group_members (
            run_guid UUID,
            character_name VARCHAR(64),
            class_id INTEGER,
            spec_id INTEGER,
            role VARCHAR(16)
          ) ON COMMIT DROP;
        `);

        await Promise.all([
          new Promise((resolve, reject) => {
            const stream = client.query(copyFrom('COPY temp_leaderboard_runs FROM STDIN WITH (FORMAT csv)'));
            const fileStream = fs.createReadStream(batchRunsCsvPath);
            pipeline(fileStream, stream, err => err ? reject(err) : resolve());
          }),
          new Promise((resolve, reject) => {
            const stream = client.query(copyFrom('COPY temp_run_group_members FROM STDIN WITH (FORMAT csv)'));
            const fileStream = fs.createReadStream(batchMembersCsvPath);
            pipeline(fileStream, stream, err => err ? reject(err) : resolve());
          })
        ]);

        await client.query(`
          INSERT INTO leaderboard_run (region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid)
          SELECT DISTINCT ON (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
            region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid
          FROM temp_leaderboard_runs
          ON CONFLICT (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
          DO UPDATE SET 
            score = EXCLUDED.score,
            rank = EXCLUDED.rank,
            realm_id = EXCLUDED.realm_id;
        `);

        await client.query(`
          INSERT INTO run_group_member (run_guid, character_name, class_id, spec_id, role)
          SELECT DISTINCT ON (run_guid, character_name) 
            run_guid, character_name, class_id, spec_id, role
          FROM temp_run_group_members
          WHERE run_guid IN (SELECT run_guid FROM leaderboard_run)
          ON CONFLICT (run_guid, character_name) 
          DO UPDATE SET
            class_id = EXCLUDED.class_id,
            spec_id = EXCLUDED.spec_id,
            role = EXCLUDED.role;
        `);

        await client.query('COMMIT');

        // Update totals and per-file results
        for (const result of batchResults) {
          if (result.status === 'fulfilled' && result.value && (result.value.runs || result.value.members)) {
            totalRuns += result.value.runs || 0;
            totalMembers += result.value.members || 0;
            results.push(result.value);
          } else if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            results.push({ error: result.reason && result.reason.message });
          }
        }

        // Optionally remove processed files after successful commit
        if (DELETE_PROCESSED) {
          for (const fname of batchFiles) {
            const fp = path.join(outputDir, fname);
            try { fs.unlinkSync(fp); } catch (e) { console.warn(`[IMPORT ALL FAST] Failed to delete ${fname}: ${e.message}`); }
          }
        }

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[IMPORT ALL FAST ERROR] Batch processing error:`, err);
        throw err;
      } finally {
        client.release();
        try {
          fs.unlinkSync(batchRunsCsvPath);
          fs.unlinkSync(batchMembersCsvPath);
        } catch (err) {
          console.warn(`[IMPORT ALL FAST] Warning: Could not delete temporary files:`, err.message);
        }
      }

      // Advance window for next batch within this request
      files = files.slice(BATCH_SIZE);
      processedFilesCount += batchFiles.length;
      batchesProcessed += 1;
    }

    const remainingFiles = files.length;
    console.log(`[IMPORT ALL FAST] Request complete. Batches processed: ${batchesProcessed}, files processed: ${processedFilesCount}, remaining: ${remainingFiles}. Totals so far -> runs: ${totalRuns}, members: ${totalMembers}`);
    res.json({ status: 'OK', totalRuns, totalMembers, results, batchesProcessed, processedFilesCount, remainingFiles });

  } catch (error) {
    console.error('[IMPORT ALL FAST ERROR]', error);
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// Cleanup endpoint: keep only top 1000 runs per (dungeon_id, period_id, season_id)
// Optimized with CTE for better performance
router.post('/cleanup-leaderboard', async (req, res) => {
  const { season_id } = req.body || {};
  
  // Use CTE approach for better performance (Strategy #2)
  let sql = `
    WITH to_delete AS (
      SELECT id FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY season_id, period_id, dungeon_id
            ORDER BY keystone_level DESC, score DESC
          ) AS rn
        FROM leaderboard_run
        ${season_id ? 'WHERE season_id = $1' : ''}
      ) ranked
      WHERE rn > 1000
    )
    DELETE FROM leaderboard_run
    WHERE id IN (SELECT id FROM to_delete);
  `;
  
  try {
    console.log(`[CLEANUP] Starting cleanup for ${season_id ? `season_id = ${season_id}` : 'all seasons'}`);
    const startTime = Date.now();
    
    const result = season_id
      ? await db.pool.query(sql, [season_id])
      : await db.pool.query(sql);
    
    const duration = Date.now() - startTime;
    console.log(`[CLEANUP] Completed in ${duration}ms. Deleted ${result.rowCount} rows.`);
    
    res.json({ 
      status: 'OK', 
      rows_deleted: result.rowCount,
      duration_ms: duration,
      message: `Deleted ${result.rowCount} rows in ${duration}ms`
    });
  } catch (err) {
    console.error('[CLEANUP ERROR]', err);
    res.status(500).json({ status: 'ERROR', error: err.message });
  }
});

// --- Clear output directory endpoint ---
router.post('/clear-output', async (req, res) => {
  const outputDir = path.join(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
  }
  const files = fs.readdirSync(outputDir);
  let deleted = [];
  let errors = [];
  for (const file of files) {
    const filePath = path.join(outputDir, file);
    try {
      fs.unlinkSync(filePath);
      deleted.push(file);
    } catch (err) {
      errors.push({ file, error: err.message });
    }
  }
  res.json({ status: 'OK', deleted, errors });
});

// --- Refresh materialized views endpoint ---
router.post('/refresh-views', async (req, res) => {
  const startTime = Date.now();
  const views = [
    'top_keys_per_group',
    'top_keys_global', 
    'top_keys_per_period',
    'top_keys_per_dungeon'
  ];
  
  try {
    console.log(`[REFRESH-VIEWS] Starting refresh of ${views.length} materialized views...`);
    
    for (let i = 0; i < views.length; i++) {
      const viewName = views[i];
      const viewStartTime = Date.now();
      
      console.log(`[REFRESH-VIEWS] Refreshing view ${i + 1}/${views.length}: ${viewName}...`);
      
      // Use CONCURRENTLY refresh to allow views to remain available during refresh
      await db.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName};`);
      
      const viewDuration = (Date.now() - viewStartTime) / 1000;
      console.log(`[REFRESH-VIEWS] ✅ Completed ${viewName} in ${viewDuration.toFixed(1)}s`);
    }
    
    const totalDuration = (Date.now() - startTime) / 1000;
    const message = `All ${views.length} materialized views refreshed in ${totalDuration.toFixed(1)}s`;
    
    console.log(`[REFRESH-VIEWS] ${message}`);
    res.json({ 
      status: 'OK', 
      message,
      duration_seconds: totalDuration,
      views_refreshed: views.length
    });
  } catch (error) {
    const errorDuration = (Date.now() - startTime) / 1000;
    console.error(`[REFRESH-VIEWS] ❌ Failed after ${errorDuration.toFixed(1)}s:`, error.message);
    res.status(500).json({ 
      status: 'NOT OK', 
      error: error.message,
      duration_seconds: errorDuration 
    });
  }
});

// --- Async refresh materialized views endpoint (non-blocking) ---
router.post('/refresh-views-async', async (req, res) => {
  const views = [
    'top_keys_per_group',
    'top_keys_global', 
    'top_keys_per_period',
    'top_keys_per_dungeon'
  ];
  
  // Start the refresh process in the background
  const refreshPromise = (async () => {
    const startTime = Date.now();
    console.log(`[REFRESH-VIEWS-ASYNC] Starting background refresh of ${views.length} materialized views...`);
    
    try {
      for (let i = 0; i < views.length; i++) {
        const viewName = views[i];
        const viewStartTime = Date.now();
        
        console.log(`[REFRESH-VIEWS-ASYNC] Refreshing view ${i + 1}/${views.length}: ${viewName}...`);
        await db.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName};`);
        
        const viewDuration = (Date.now() - viewStartTime) / 1000;
        console.log(`[REFRESH-VIEWS-ASYNC] ✅ Completed ${viewName} in ${viewDuration.toFixed(1)}s`);
      }
      
      const totalDuration = (Date.now() - startTime) / 1000;
      console.log(`[REFRESH-VIEWS-ASYNC] ✅ All ${views.length} materialized views refreshed in ${totalDuration.toFixed(1)}s`);
    } catch (error) {
      const errorDuration = (Date.now() - startTime) / 1000;
      console.error(`[REFRESH-VIEWS-ASYNC] ❌ Background refresh failed after ${errorDuration.toFixed(1)}s:`, error.message);
    }
  })();
  
  // Return immediately without waiting
  res.json({ 
    status: 'OK', 
    message: 'Materialized views refresh started in background',
    views_to_refresh: views.length,
    note: 'Check server logs for progress updates'
  });
});

// --- Automation endpoints for Render.com ---

// POST /admin/automation/trigger - Trigger the full daily automation
router.post('/automation/trigger', async (req, res) => {
  try {
    console.log('[AUTOMATION] Manual trigger received');
    
    // Run the automation in the background
    automation.runDailyAutomation()
      .then(result => {
        console.log('[AUTOMATION] Background automation completed:', result.status);
      })
      .catch(error => {
        console.error('[AUTOMATION] Background automation failed:', error);
      });
    
    // Return immediately to avoid timeout
    res.json({ 
      status: 'OK', 
      message: 'Automation started in background',
      note: 'Check logs for progress and completion status'
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/automation/trigger-sync - Trigger automation synchronously (for testing)
router.post('/automation/trigger-sync', async (req, res) => {
  try {
    console.log('[AUTOMATION] Synchronous trigger received');
    
    const result = await automation.runDailyAutomation();
    
    res.json({
      status: result.status === 'success' ? 'OK' : 'NOT OK',
      result: result
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// GET /admin/automation/status - Check automation status
router.get('/automation/status', async (req, res) => {
  try {
    // This is a simple status endpoint - in a real implementation,
    // you might want to store automation status in a database
    res.json({
      status: 'OK',
      message: 'Automation system is ready',
      endpoints: {
        trigger: 'POST /admin/automation/trigger - Start automation in background',
        triggerSync: 'POST /admin/automation/trigger-sync - Start automation synchronously',
        status: 'GET /admin/automation/status - Check this endpoint'
      }
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/automation/fetch-data - Trigger only the data fetching step
router.post('/automation/fetch-data', async (req, res) => {
  try {
    console.log('[AUTOMATION] Fetch data trigger received');
    
    const result = await automation.fetchLeaderboardData();
    
    res.json({
      status: 'OK',
      result: result
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/automation/import-data - Trigger only the import step
router.post('/automation/import-data', async (req, res) => {
  try {
    console.log('[AUTOMATION] Import data trigger received');
    
    const result = await automation.importLeaderboardData();
    
    res.json({
      status: 'OK',
      result: result
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/automation/cleanup - Trigger only the cleanup step
router.post('/automation/cleanup', async (req, res) => {
  try {
    console.log('[AUTOMATION] Cleanup trigger received');
    
    const { season_id } = req.body || {};
    if (!season_id) {
      return res.status(400).json({ 
        status: 'NOT OK', 
        error: 'season_id is required in request body' 
      });
    }
    
    const result = await automation.cleanupLeaderboard(season_id);
    
    res.json({
      status: 'OK',
      result: result
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/automation/refresh-views - Trigger only the refresh views step
router.post('/automation/refresh-views', async (req, res) => {
  try {
    console.log('[AUTOMATION] Refresh views trigger received');
    
    const result = await automation.refreshViews();
    
    res.json({
      status: 'OK',
      result: result
    });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/vacuum-full - Perform VACUUM FULL on the database (intensive operation)
router.post('/vacuum-full', async (req, res) => {
  try {
    console.log('[ADMIN] VACUUM FULL started');
    
    // Set a longer timeout for VACUUM operations
    const client = await db.pool.connect();
    try {
      // Set statement timeout to 30 minutes for VACUUM operations
      await client.query('SET statement_timeout = 21600000'); // 6 hours
      
      // VACUUM FULL requires exclusive access and can take a very long time
      // It reclaims all available disk space and defragments tables
      const result = await client.query('VACUUM FULL');
      
      console.log('[ADMIN] VACUUM FULL completed');
      
      res.json({
        status: 'OK',
        message: 'VACUUM FULL completed successfully',
        result: result
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[ADMIN ERROR] VACUUM FULL failed:', error.message);
    res.status(500).json({ 
      status: 'NOT OK', 
      error: error.message,
      note: 'VACUUM FULL is very intensive and may timeout. Consider using /admin/vacuum-analyze for safer operation'
    });
  }
});

// POST /admin/vacuum-analyze - Perform VACUUM ANALYZE on the database
router.post('/vacuum-analyze', async (req, res) => {
  try {
    console.log('[ADMIN] VACUUM ANALYZE started');
    
    // Set a longer timeout for VACUUM operations
    const client = await db.pool.connect();
    try {
      // Set statement timeout to 30 minutes for VACUUM operations
      await client.query('SET statement_timeout = 21600000'); // 6 hours
      
      // VACUUM ANALYZE updates statistics and reclaims some space
      // It doesn't require exclusive access and won't block other operations
      const result = await client.query('VACUUM ANALYZE');
      
      console.log('[ADMIN] VACUUM ANALYZE completed');
      
      res.json({
        status: 'OK',
        message: 'VACUUM ANALYZE completed successfully',
        result: result
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[ADMIN ERROR] VACUUM ANALYZE failed:', error.message);
    res.status(500).json({ 
      status: 'NOT OK', 
      error: error.message,
      note: 'If this operation times out, consider running it during low-traffic periods'
    });
  }
});

// --- Simple DB-backed job lock ---
// Ensures only one long-running job (e.g., daily vs weekly) runs at a time
async function ensureJobLockTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_lock (
      lock_name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      job TEXT,
      acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
}

// POST /admin/job-lock/acquire
// Body: { lock_name: string, owner: string, ttl_seconds?: number, job?: string }
router.post('/job-lock/acquire', async (req, res) => {
  const { lock_name, owner, ttl_seconds = 21600, job = null, steal = false } = req.body || {};
  if (!lock_name || !owner) {
    return res.status(400).json({ status: 'NOT OK', error: 'lock_name and owner are required' });
  }

  const client = await db.pool.connect();
  try {
    await ensureJobLockTable(client);

    // Try to acquire atomically. If lock exists but expired, take it over.
    const result = await client.query(
      `
      INSERT INTO job_lock (lock_name, owner, job, acquired_at, expires_at)
      VALUES ($1, $2, $3, NOW(), NOW() + ($4 || ' seconds')::INTERVAL)
      ON CONFLICT (lock_name)
      DO UPDATE SET
        owner = EXCLUDED.owner,
        job = EXCLUDED.job,
        acquired_at = NOW(),
        expires_at = NOW() + ($4 || ' seconds')::INTERVAL
      WHERE job_lock.expires_at < NOW() OR $5::boolean IS TRUE
      RETURNING lock_name, owner, job, acquired_at, expires_at;
      `,
      [lock_name, owner, job, ttl_seconds.toString(), !!steal]
    );

    if (result.rowCount === 0) {
      // Lock is currently held and not expired
      const { rows } = await client.query('SELECT lock_name, owner, job, acquired_at, expires_at FROM job_lock WHERE lock_name = $1', [lock_name]);
      const current = rows[0];
      return res.status(409).json({ status: 'LOCKED', message: 'Lock is already held', current });
    }

    return res.json({ status: 'OK', lock: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ status: 'NOT OK', error: error.message });
  } finally {
    client.release();
  }
});

// POST /admin/job-lock/release
// Body: { lock_name: string, owner: string }
router.post('/job-lock/release', async (req, res) => {
  const { lock_name, owner } = req.body || {};
  if (!lock_name || !owner) {
    return res.status(400).json({ status: 'NOT OK', error: 'lock_name and owner are required' });
  }

  try {
    const result = await db.pool.query('DELETE FROM job_lock WHERE lock_name = $1 AND owner = $2', [lock_name, owner]);
    if (result.rowCount === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'Lock not found for this owner (may have expired or been taken over)' });
    }
    return res.json({ status: 'OK', released: true });
  } catch (error) {
    return res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/job-lock/force-release
// Body: { lock_name: string }
// Admin override: delete a lock by name regardless of owner/expiry
router.post('/job-lock/force-release', async (req, res) => {
  const { lock_name } = req.body || {};
  if (!lock_name) {
    return res.status(400).json({ status: 'NOT OK', error: 'lock_name is required' });
  }
  try {
    const result = await db.pool.query('DELETE FROM job_lock WHERE lock_name = $1', [lock_name]);
    return res.json({ status: 'OK', deleted: result.rowCount });
  } catch (error) {
    return res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// GET /admin/job-lock/list - list all current locks
router.get('/job-lock/list', async (_req, res) => {
  try {
    const { rows } = await db.pool.query('SELECT lock_name, owner, job, acquired_at, expires_at FROM job_lock ORDER BY lock_name');
    res.json({ status: 'OK', locks: rows });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// GET /admin/job-lock/status?lock_name=...
router.get('/job-lock/status', async (req, res) => {
  const lock_name = req.query.lock_name;
  if (!lock_name) {
    return res.status(400).json({ status: 'NOT OK', error: 'lock_name is required' });
  }
  try {
    const { rows } = await db.pool.query('SELECT lock_name, owner, job, acquired_at, expires_at FROM job_lock WHERE lock_name = $1', [lock_name]);
    if (rows.length === 0) return res.json({ status: 'OK', locked: false });
    const lock = rows[0];
    const locked = new Date(lock.expires_at) > new Date();
    return res.json({ status: 'OK', locked, lock });
  } catch (error) {
    return res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Database monitoring endpoints ---

// GET /admin/db/stats - Get database performance statistics
router.get('/db/stats', async (req, res) => {
  try {
    const client = await db.pool.connect();
    
    try {
      // Get connection pool stats
      const poolStats = {
        totalCount: db.pool.totalCount,
        idleCount: db.pool.idleCount,
        waitingCount: db.pool.waitingCount
      };

      // Get PostgreSQL server stats
      const serverStats = await client.query(`
        SELECT 
          version(),
          current_setting('max_connections')::int as max_connections,
          current_setting('shared_buffers') as shared_buffers,
          current_setting('work_mem') as work_mem,
          current_setting('maintenance_work_mem') as maintenance_work_mem,
          current_setting('effective_cache_size') as effective_cache_size
      `);

      // Get active connections
      const activeConnections = await client.query(`
        SELECT 
          count(*) as active_connections,
          count(*) filter (where state = 'active') as active_queries,
          count(*) filter (where state = 'idle') as idle_connections,
          count(*) filter (where state = 'idle in transaction') as idle_in_transaction
        FROM pg_stat_activity 
        WHERE datname = current_database()
      `);

      // Get table sizes
      const tableSizes = await client.query(`
        SELECT 
          n.nspname as schemaname,
          c.relname as tablename,
          pg_size_pretty(pg_total_relation_size(n.nspname||'.'||c.relname)) as size,
          pg_total_relation_size(n.nspname||'.'||c.relname) as size_bytes
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' 
        AND c.relkind = 'r'  -- Only tables
        ORDER BY pg_total_relation_size(n.nspname||'.'||c.relname) DESC
        LIMIT 10
      `);

      // Get index usage stats
      const indexStats = await client.query(`
        SELECT 
          s.schemaname,
          s.relname as tablename,
          s.indexrelname as indexname,
          s.idx_scan as index_scans,
          s.idx_tup_read as tuples_read,
          s.idx_tup_fetch as tuples_fetched
        FROM pg_stat_all_indexes s
        JOIN pg_class c ON c.oid = s.relid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY s.idx_scan DESC 
        LIMIT 10
      `);

      // Get slow queries (if pg_stat_statements extension is available)
      let slowQueries = { rows: [] };
      try {
        const slowQueriesResult = await client.query(`
          SELECT 
            query,
            calls,
            total_time,
            mean_time,
            rows
          FROM pg_stat_statements 
          ORDER BY total_time DESC 
          LIMIT 10
        `);
        slowQueries = slowQueriesResult;
      } catch (err) {
        console.log('pg_stat_statements extension not available, skipping slow queries');
      }

      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        pool: poolStats,
        server: serverStats.rows[0],
        connections: activeConnections.rows[0],
        table_sizes: tableSizes.rows,
        index_stats: indexStats.rows,
        slow_queries: slowQueries.rows
      });

    } finally {
      client.release();
    }

  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// GET /admin/db/performance-test - Run a performance test
router.get('/db/performance-test', async (req, res) => {
  try {
    const client = await db.pool.connect();
    const results = {};

    try {
      // Test 1: Simple query performance
      const start1 = Date.now();
      await client.query('SELECT COUNT(*) FROM leaderboard_run');
      results.simple_count_query_ms = Date.now() - start1;

      // Test 2: Complex query performance
      const start2 = Date.now();
      await client.query(`
        SELECT 
          dungeon_id, 
          COUNT(*) as run_count,
          AVG(keystone_level) as avg_level
        FROM leaderboard_run 
        GROUP BY dungeon_id 
        ORDER BY run_count DESC 
        LIMIT 10
      `);
      results.complex_group_query_ms = Date.now() - start2;

      // Test 3: Index scan performance
      const start3 = Date.now();
      await client.query(`
        SELECT COUNT(*) 
        FROM leaderboard_run 
        WHERE season_id = 1 AND period_id = 1
      `);
      results.index_scan_query_ms = Date.now() - start3;

      // Test 4: Concurrent connection test
      const start4 = Date.now();
      const concurrentQueries = Array(10).fill().map(() => 
        client.query('SELECT 1')
      );
      await Promise.all(concurrentQueries);
      results.concurrent_queries_ms = Date.now() - start4;

      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        performance_tests: results
      });

    } finally {
      client.release();
    }

  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// POST /admin/db/analyze - Run ANALYZE on all tables
router.post('/db/analyze', async (req, res) => {
  try {
    const client = await db.pool.connect();
    
    try {
      const start = Date.now();
      await client.query('ANALYZE');
      const duration = Date.now() - start;

      res.json({
        status: 'OK',
        message: 'ANALYZE completed successfully',
        duration_ms: duration
      });

    } finally {
      client.release();
    }

  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

module.exports = router;
module.exports.populateDungeons = populateDungeons;
module.exports.populateSeasons = populateSeasons;
module.exports.populatePeriods = populatePeriods;
module.exports.populateRealms = populateRealms;
module.exports.syncRaiderioStatic = syncRaiderioStatic;