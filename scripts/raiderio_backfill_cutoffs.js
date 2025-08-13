/*
 One-time backfill script: iterate seasons and regions and build Raider.IO cutoff snapshots.
 Usage:
   node scripts/raiderio_backfill_cutoffs.js

 Env (optional):
   PORT=3000
   INTERNAL_API_BASE=http://localhost:3000
   ADMIN_API_KEY=...
   BACKFILL_EXPANSIONS=10,9          // defaults to TWW(10) and DF(9)
   BACKFILL_REGIONS=us,eu,kr,tw      // defaults to all 4
   BACKFILL_MAIN_SEASONS_ONLY=true   // defaults true
   BACKFILL_CONCURRENCY=1            // sequential by default to avoid rate limits
*/

require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.INTERNAL_API_BASE || `http://localhost:${process.env.PORT || 3000}`;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

function parseCsvNumbers(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n));
}

function parseCsvStrings(value, fallback) {
  if (!value) return fallback;
  return String(value)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchStaticData(expansionId) {
  const url = `${API_BASE}/raiderio/static-data?expansion_id=${expansionId}`;
  const { data } = await axios.get(url);
  return data;
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
  const url = `${API_BASE}/admin/raiderio/rebuild-top-cutoff?${params.toString()}`;
  const { data } = await axios.post(url, {}, { headers: { 'x-admin-api-key': ADMIN_API_KEY } });
  return data;
}

async function main() {
  const expansions = parseCsvNumbers(process.env.BACKFILL_EXPANSIONS, [10, 9]);
  const regions = parseCsvStrings(process.env.BACKFILL_REGIONS, ['us', 'eu', 'kr', 'tw']);
  const onlyMain = String(process.env.BACKFILL_MAIN_SEASONS_ONLY || 'true').toLowerCase() === 'true';
  const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY || 1));

  console.log(`[BACKFILL] Starting. base=${API_BASE} expansions=${expansions.join(',')} regions=${regions.join(',')} onlyMain=${onlyMain} concurrency=${concurrency}`);

  // 1) Gather season slugs from static-data
  const seasonSlugs = new Set();
  for (const expId of expansions) {
    try {
      const sd = await fetchStaticData(expId);
      const seasons = Array.isArray(sd?.seasons) ? sd.seasons : [];
      for (const s of seasons) {
        if (!s?.slug) continue;
        const slug = String(s.slug);
        if (onlyMain) {
          // Accept only canonical main seasons of the form: season-<expansion>-<number>
          // Examples: season-df-4, season-sl-1, season-bfa-3
          // Exclude variants like: season-tww-2-post
          const isCanonicalMain = /^season-[a-z0-9]+-\d+$/i.test(slug);
          if (!isCanonicalMain) continue;
        }
        seasonSlugs.add(slug);
      }
    } catch (e) {
      console.warn(`[BACKFILL] Failed to load static-data for expansion ${expId}: ${e.message}`);
    }
  }

  const seasonList = Array.from(seasonSlugs);
  console.log(`[BACKFILL] Seasons selected (${seasonList.length}):`, seasonList);

  // 2) Iterate (season, region) pairs with simple concurrency control
  let active = 0;
  let idx = 0;
  const jobs = [];
  for (const season of seasonList) {
    for (const region of regions) {
      jobs.push({ season, region });
    }
  }

  const unsupportedSeasons = new Set();

  async function runNext() {
    // Skip jobs for seasons known to lack cutoffs
    while (idx < jobs.length && unsupportedSeasons.has(jobs[idx].season)) idx++;
    if (idx >= jobs.length) return;
    if (active >= concurrency) return;
    const job = jobs[idx++];
    active++;
    try {
      console.log(`[BACKFILL] → ${job.season} ${job.region}`);
      const result = await rebuildCutoff(job.season, job.region, {
        strict: String(process.env.BACKFILL_STRICT || 'false').toLowerCase() === 'true',
        max_pages: Number(process.env.BACKFILL_MAX_PAGES || ''),
        stall_pages: Number(process.env.BACKFILL_STALL_PAGES || ''),
        include_players: String(process.env.BACKFILL_INCLUDE_PLAYERS || 'false').toLowerCase() === 'true',
        dungeon_all: String(process.env.BACKFILL_DUNGEON_ALL || 'false').toLowerCase() === 'true',
        overscan: String(process.env.BACKFILL_OVERSCAN || 'false').toLowerCase() === 'true'
      });
      console.log(`[BACKFILL] ✓ ${job.season} ${job.region} snapshot=${result.snapshotId} qualifying=${result.totalQualifying}`);
    } catch (e) {
      const status = e?.response?.status;
      const msg = e?.response?.data || e.message;
      console.warn(`[BACKFILL] ✗ ${job.season} ${job.region} error:`, msg);
      if (status === 404) {
        unsupportedSeasons.add(job.season);
        console.warn(`[BACKFILL] ⇢ Marked ${job.season} unsupported. Remaining regions for this season will be skipped.`);
      }
    } finally {
      active--;
      // small pacing to be kind to API
      await sleep(500);
      await runNext();
    }
  }

  // start runners
  const runners = Array.from({ length: concurrency }, () => runNext());
  await Promise.all(runners);

  console.log('[BACKFILL] Done.');
}

main().catch(err => {
  console.error('[BACKFILL] Fatal error:', err);
  process.exit(1);
});


