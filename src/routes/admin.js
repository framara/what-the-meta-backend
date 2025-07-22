const express = require('express');
const proxyService = require('../services/proxy');
const db = require('../services/db');
const { getAllRegions } = require('../config/regions');
const fs = require('fs');
const path = require('path');
const { WOW_SPECIALIZATIONS, WOW_SPEC_ROLES } = require('../config/constants');
const pLimit = require('p-limit');

const router = express.Router();

// --- POPULATE FUNCTIONS ---
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
    const name = s.name || `Season ${id}`;
    const result = await db.pool.query(
      'INSERT INTO season (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
      [id, name]
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
        const result = await db.pool.query(
          'INSERT INTO period (id, season_id) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET season_id = EXCLUDED.season_id',
          [periodId, seasonId]
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
  try {
    const result = await populateDungeons();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-seasons', async (req, res) => {
  try {
    const result = await populateSeasons();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-periods', async (req, res) => {
  try {
    const result = await populatePeriods();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

router.post('/populate-realms', async (req, res) => {
  try {
    const result = await populateRealms();
    res.json(result);
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Admin import endpoint ---
router.post('/import-leaderboard-json', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ status: 'NOT OK', error: 'filename is required in body' });
    }
    const filePath = path.join(__dirname, '../output', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ status: 'NOT OK', error: 'File not found' });
    }
    const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`[IMPORT] Starting import for file: ${filename}`);
    console.log(`[IMPORT] Runs to import: ${runs.length}`);
    const pool = db.pool;
    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      // 1. Insert all runs, collect runIds and members
      let runIdToMembers = [];
      for (const run of runs) {
        const runInsert = await client.query(
          `INSERT INTO leaderboard_run
            (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level, score, rank)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level)
           DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank
           RETURNING id`,
          [run.dungeon_id, run.period_id, run.realm_id, run.season_id, run.region, run.completed_at, run.duration_ms, run.keystone_level, run.score, run.rank]
        );
        const runId = runInsert.rows[0].id;
        if (run.members && run.members.length > 0) {
          runIdToMembers.push({ runId, members: run.members });
        }
        inserted++;
      }
      // 2. Batch insert all run_group_member records
      let allMembers = [];
      for (const { runId, members } of runIdToMembers) {
        for (const m of members) {
          allMembers.push([runId, m.character_name, m.class_id, m.spec_id, m.role]);
        }
      }
      const batchSize = 500;
      for (let i = 0; i < allMembers.length; i += batchSize) {
        let batch = allMembers.slice(i, i + batchSize);
        batch = dedupeRunGroupMembers(batch);
        if (batch.length === 0) continue;
        const values = [];
        const placeholders = [];
        let idx = 1;
        for (const row of batch) {
          placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
          values.push(...row);
        }
        await client.query(
          `INSERT INTO run_group_member (run_id, character_name, class_id, spec_id, role)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (run_id, character_name) DO UPDATE SET
             class_id = EXCLUDED.class_id,
             spec_id = EXCLUDED.spec_id,
             role = EXCLUDED.role;`,
          values
        );
      }
      await client.query('COMMIT');
      console.log(`[IMPORT] Import complete for file: ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[IMPORT ERROR]', err);
      throw err;
    } finally {
      client.release();
    }
    res.json({ status: 'OK', inserted });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Admin import all endpoint ---
router.post('/import-all-leaderboard-json', async (req, res) => {
  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
    }
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }
    let totalInserted = 0;
    let results = [];
    const limit = pLimit(4); // Limit to 4 files in parallel
    const fileTasks = files.map(filename => limit(async () => {
      console.log(`[IMPORT ALL] Processing file: ${filename}`);
      const filePath = path.join(outputDir, filename);
      const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const pool = db.pool;
      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query('BEGIN');
        // 1. Insert all runs, collect runIds and members
        let runIdToMembers = [];
        for (const run of runs) {
          const runInsert = await client.query(
            `INSERT INTO leaderboard_run
              (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level, score, rank)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level)
             DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank
             RETURNING id`,
            [run.dungeon_id, run.period_id, run.realm_id, run.season_id, run.region, run.completed_at, run.duration_ms, run.keystone_level, run.score, run.rank]
          );
          const runId = runInsert.rows[0].id;
          if (run.members && run.members.length > 0) {
            runIdToMembers.push({ runId, members: run.members });
          }
          inserted++;
        }
        // 2. Batch insert all run_group_member records
        let allMembers = [];
        for (const { runId, members } of runIdToMembers) {
          for (const m of members) {
            allMembers.push([runId, m.character_name, m.class_id, m.spec_id, m.role]);
          }
        }
        const batchSize = 500;
        for (let i = 0; i < allMembers.length; i += batchSize) {
          let batch = allMembers.slice(i, i + batchSize);
          batch = dedupeRunGroupMembers(batch);
          if (batch.length === 0) continue;
          const values = [];
          const placeholders = [];
          let idx = 1;
          for (const row of batch) {
            placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
            values.push(...row);
          }
          await client.query(
            `INSERT INTO run_group_member (run_id, character_name, class_id, spec_id, role)
             VALUES ${placeholders.join(',')}
             ON CONFLICT (run_id, character_name) DO UPDATE SET
               class_id = EXCLUDED.class_id,
               spec_id = EXCLUDED.spec_id,
               role = EXCLUDED.role;`,
            values
          );
        }
        await client.query('COMMIT');
        console.log(`[IMPORT ALL] Import complete for file: ${filename}`);
        return { filename, inserted };
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[IMPORT ALL ERROR] File: ${filename}`, err);
        return { filename, error: err.message };
      } finally {
        client.release();
      }
    }));
    const settled = await Promise.allSettled(fileTasks);
    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value && result.value.inserted) {
        totalInserted += result.value.inserted;
        results.push(result.value);
      } else if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({ error: result.reason && result.reason.message });
      }
    }
    res.json({ status: 'OK', totalInserted, results });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

module.exports = router;
module.exports.populateDungeons = populateDungeons;
module.exports.populateSeasons = populateSeasons;
module.exports.populatePeriods = populatePeriods;
module.exports.populateRealms = populateRealms; 