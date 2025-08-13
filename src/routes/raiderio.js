const express = require('express');
const validateRegion = require('../middleware/region');
const raiderIO = require('../services/raiderio/client');
const db = require('../services/db');

const router = express.Router();
// Lightweight concurrency limiter to avoid pulling extra deps
function withConcurrency(limit, tasks) {
  return new Promise((resolve) => {
    if (!Array.isArray(tasks) || tasks.length === 0) return resolve();
    let inFlight = 0;
    let index = 0;
    let completed = 0;
    const total = tasks.length;
    function runNext() {
      while (inFlight < limit && index < total) {
        const curr = tasks[index++];
        inFlight++;
        Promise.resolve()
          .then(() => curr())
          .catch(() => {})
          .finally(() => {
            inFlight--;
            completed++;
            if (completed === total) return resolve();
            runNext();
          });
      }
    }
    runNext();
  });
}

// Validate region on all Raider.IO endpoints (optional per-endpoint override via query.region)
router.use(validateRegion);

// GET /raiderio/season-cutoffs?season=season-tww-2&region=us
router.get('/season-cutoffs', async (req, res, next) => {
  try {
    const { season } = req.query;
    const region = req.region;
    const data = await raiderIO.getSeasonCutoffs({ season, region });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /raiderio/static-data?expansion_id=10
router.get('/static-data', async (req, res, next) => {
  try {
    const expansion_id = req.query.expansion_id ? Number(req.query.expansion_id) : undefined;
    const data = await raiderIO.getStaticData({ expansion_id });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /raiderio/top-tenth-percent?season=season-tww-2&region=us
// Returns distribution of players/classes/specs who meet or exceed the 0.1% cutoff
router.get('/top-tenth-percent', async (req, res, next) => {
  try {
    const { season } = req.query;
    const region = req.region;
    if (!season) return res.status(400).json({ error: true, message: 'Missing required query param: season' });

    // 1) get cutoffs (contains overall and role cutoffs; we use overall per region)
    const cutoffs = await raiderIO.getSeasonCutoffs({ season, region });
    // Preferred path from Raider.IO payload for Top 0.1% (p999) combined (all factions)
    // Example: cutoffs.cutoffs.p999.all.quantileMinValue
    let cutoffScore = cutoffs?.cutoffs?.p999?.all?.quantileMinValue ?? null;
    
    // Fallback: if "all" is absent, use the max of horde/alliance cutoffs if available
    if (cutoffScore == null) {
      const horde = cutoffs?.cutoffs?.p999?.horde?.quantileMinValue;
      const alliance = cutoffs?.cutoffs?.p999?.alliance?.quantileMinValue;
      const nums = [horde, alliance].filter(v => typeof v === 'number');
      if (nums.length > 0) cutoffScore = Math.max(...nums);
    }

    // Legacy/defensive fallbacks (older assumptions): search for quantile_0_1.score
    const regionKeyUpper = (region || '').toUpperCase();
    const regionKeyLower = (region || '').toLowerCase();
    try {
      if (cutoffScore == null) {
        cutoffScore = (
          cutoffs?.cutoffs?.region?.[regionKeyUpper]?.overall?.all?.quantile_0_1?.score
          ?? cutoffs?.cutoffs?.region?.[regionKeyLower]?.overall?.all?.quantile_0_1?.score
          ?? cutoffs?.cutoffs?.[regionKeyUpper]?.overall?.all?.quantile_0_1?.score
          ?? cutoffs?.cutoffs?.[regionKeyLower]?.overall?.all?.quantile_0_1?.score
          ?? cutoffs?.overall?.all?.quantile_0_1?.score
          ?? (() => {
            const list = cutoffs?.regions || cutoffs?.cutoffs?.regions || [];
            if (Array.isArray(list)) {
              const found = list.find(r => (r?.name || r?.tag || '').toString().toUpperCase() === regionKeyUpper);
              return found?.overall?.all?.quantile_0_1?.score ?? null;
            }
            return null;
          })()
        );
      }
    } catch (_) {}

    if (cutoffScore == null) {
      // Deep search for any quantile_0_1.score; prefer matches under region
      function findQuantileScore(node, path, preferredKeys) {
        let best = { score: null, weight: -1 };
        function visit(curr, currPath) {
          if (!curr || typeof curr !== 'object') return;
          const q = curr?.quantile_0_1;
          if (q && typeof q.score === 'number') {
            const joined = currPath.join('.').toLowerCase();
            let weight = 0;
            for (const key of preferredKeys) {
              if (joined.includes(key)) { weight = 2; break; }
            }
            if (weight > best.weight) best = { score: q.score, weight };
          }
          for (const [k, v] of Object.entries(curr)) visit(v, currPath.concat(k));
        }
        visit(node, path || []);
        return best.score;
      }
      cutoffScore = findQuantileScore(cutoffs, [], [regionKeyLower, regionKeyUpper.toLowerCase()]) ?? null;
    }

    if (cutoffScore == null) {
      return res.status(502).json({ error: true, message: 'Failed to resolve 0.1% cutoff score from Raider.IO payload', debug: { cutoffs } });
    }

    // 2) Alternative approach: fetch top runs and collect unique players meeting cutoff
    // We will page through top runs and enrich characters to get season score when needed
    const concurrency = Math.max(1, Number(req.query.concurrency || 8));
    const maxPages = Math.max(1, Number(req.query.maxPages || 20));
    let page = 0;
    let hasMore = true;
    const qualifyingCharacters = new Map(); // key: region:realm:name -> { class, spec }
    const seenCharacters = new Set();

    while (hasMore) {
      let runs = [];
      try {
        const resp = await raiderIO.getTopRuns({ season, region, page, dungeon: 'all' });
        const rankings = resp?.rankings || [];
        runs = Array.isArray(rankings) ? rankings.map(r => r.run).filter(Boolean) : [];
      } catch (e) {
        const status = e?.response?.status;
        if (status === 429) {
          // Back off briefly and retry once
          await new Promise(r => setTimeout(r, 1200));
          try {
            const resp = await raiderIO.getTopRuns({ season, region, page, dungeon: 'all' });
            const rankings = resp?.rankings || [];
            runs = Array.isArray(rankings) ? rankings.map(r => r.run).filter(Boolean) : [];
          } catch (e2) {
            hasMore = false;
            break;
          }
        } else if (status >= 500) {
          hasMore = false;
          break;
        } else {
          throw e;
        }
      }
      if (!Array.isArray(runs) || runs.length === 0) break;

      const tasks = [];
      for (const run of runs) {
        const members = run?.roster || [];
        for (const m of members) {
          const character = m?.character || m;
          const realm = character?.realm?.slug || character?.realm?.name || character?.realm || null;
          const name = character?.name || character?.character?.name || null;
          const className = character?.class?.name || character?.class || m?.class || 'Unknown';
          const specName = character?.spec?.name || character?.spec || m?.spec || 'Unknown';
          if (!realm || !name) continue;
          const key = `${region}:${String(realm).toLowerCase()}:${String(name).toLowerCase()}`;
          if (seenCharacters.has(key) || qualifyingCharacters.has(key)) continue;
          seenCharacters.add(key);

          tasks.push(async () => {
            // Inline score rarely present in this payload; fetch profile
            try {
              const profile = await raiderIO.getCharacterProfile({
                region,
                realm,
                name,
                fields: 'mythic_plus_scores_by_season:current'
              });
              const score = profile?.mythic_plus_scores_by_season?.[0]?.scores?.all
                ?? profile?.mythic_plus_scores_by_season?.[0]?.segments?.all?.score
                ?? profile?.mythic_plus_score
                ?? null;
              const meets = typeof score === 'number' && score >= cutoffScore;
              if (meets) {
                qualifyingCharacters.set(key, { className, specName });
              }
            } catch (_) { /* ignore */ }
          });
        }
      }

      await withConcurrency(concurrency, tasks);

      page += 1;
      // If we reached or exceeded expected population, we can stop early
      const expectedTopCount = cutoffs?.cutoffs?.p999?.all?.quantilePopulationCount;
      if (typeof expectedTopCount === 'number' && qualifyingCharacters.size >= expectedTopCount) {
        hasMore = false;
      }
      // Hard stop to avoid paging forever
      if (page >= maxPages) {
        hasMore = false;
      }
    }

    // 3) build distribution by class/spec from unique characters
    const distribution = {};
    for (const { className, specName } of qualifyingCharacters.values()) {
      if (!distribution[className]) distribution[className] = { total: 0, specs: {} };
      if (!distribution[className].specs[specName]) distribution[className].specs[specName] = 0;
      distribution[className].total += 1;
      distribution[className].specs[specName] += 1;
    }

    res.json({
      region,
      season,
      cutoffScore,
      totalQualifying: qualifyingCharacters.size,
      distribution,
      sample: Array.from(qualifyingCharacters.keys()).slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// New read-only endpoints for cutoff snapshots
// GET /raiderio/cutoff-snapshots/latest?season=season-df-4&region=us
router.get('/cutoff-snapshots/latest', async (req, res, next) => {
  try {
    const season = req.query.season;
    const region = req.query.region || req.region;
    if (!season || !region) return res.status(400).json({ error: true, message: 'season and region are required' });
    const snap = await db.getLatestCutoffSnapshot(season, region.toLowerCase());
    if (!snap) return res.status(404).json({ error: true, message: 'No snapshot found' });
    // Add color hint for cutoff visuals (static for now; can be made season-specific)
    res.json({ ...snap, allColor: '#f77149' });
  } catch (err) { next(err); }
});

// GET /raiderio/cutoff-snapshots/index -> latest per season+region
router.get('/cutoff-snapshots/index', async (_req, res, next) => {
  try {
    const rows = await db.getLatestCutoffSnapshotsIndex();
    res.json(rows.map(r => ({ ...r, allColor: '#f77149' })));
  } catch (err) { next(err); }
});

// GET /raiderio/cutoff-snapshots/by-season?season=season-df-4 -> latest for all regions
router.get('/cutoff-snapshots/by-season', async (req, res, next) => {
  try {
    const season = req.query.season;
    if (!season) return res.status(400).json({ error: true, message: 'season is required' });
    const rows = await db.getLatestCutoffSnapshotsBySeason(season);
    res.json(rows.map(r => ({ ...r, allColor: '#f77149' })));
  } catch (err) { next(err); }
});


