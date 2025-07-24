const express = require('express');
const proxyService = require('../services/proxy');
const db = require('../services/db');
const { getAllRegions } = require('../config/regions');
const fs = require('fs');
const path = require('path');
const { WOW_SPECIALIZATIONS, WOW_SPEC_ROLES } = require('../config/constants');
const pLimit = require('p-limit');
const { pipeline } = require('stream');
const { promisify } = require('util');
const copyFrom = require('pg-copy-streams').from;
const os = require('os');
const { v4: uuidv4 } = require('uuid');

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
        const runGuid = run.run_guid;
        const runInsert = await client.query(
          `INSERT INTO leaderboard_run
            (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level, score, rank, run_guid)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
           DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank
           RETURNING id`,
          [run.dungeon_id, run.period_id, run.realm_id, run.season_id, run.region, run.completed_at, run.duration_ms, run.keystone_level, run.score, run.rank, runGuid]
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
          const memberRunGuid = run.run_guid;
          allMembers.push([runId, m.character_name, m.class_id, m.spec_id, m.role, memberRunGuid]);
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
          placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
          values.push(...row);
        }
        await client.query(
          `INSERT INTO run_group_member (run_id, character_name, class_id, spec_id, role, run_guid)
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
  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
    }
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }
    let totalRuns = 0;
    let totalMembers = 0;
    let results = [];
    const limit = pLimit(8); // Limit to 4 files in parallel
    let completed = 0;
    const totalFiles = files.length;
    const fileTasks = files.map(filename => limit(async () => {
      //console.log(`[IMPORT ALL] Processing file: ${filename}`);
      const filePath = path.join(outputDir, filename);
      const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const pool = db.pool;
      const client = await pool.connect();
      let inserted = 0;
      try {
        await client.query('BEGIN');
        // 1. Insert all runs, collect runGuids for successful inserts
        let runGuids = runs.map(run => run.run_guid);
        const runValues = [];
        const runPlaceholders = [];
        let runIdx = 1;
        for (const run of runs) {
          runPlaceholders.push(`($${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++},$${runIdx++})`);
          runValues.push(
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
          );
        }
        if (runValues.length > 0) {
          await client.query(
            `INSERT INTO leaderboard_run (region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid)
             VALUES ${runPlaceholders.join(',')}
             ON CONFLICT (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
             DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, realm_id = EXCLUDED.realm_id;`,
            runValues
          );
        }
        // 2. Query for present run_guids
        const { rows } = await client.query(
          'SELECT run_guid FROM leaderboard_run WHERE run_guid = ANY($1)',
          [runGuids]
        );
        const presentRunGuids = new Set(rows.map(r => r.run_guid));
        // 3. Batch insert all run_group_member records for present run_guids
        let allMembers = [];
        for (const run of runs) {
          if (run.members && run.members.length > 0 && presentRunGuids.has(run.run_guid)) {
            for (const m of run.members) {
              allMembers.push([run.run_guid, m.character_name, m.class_id, m.spec_id, m.role]);
            }
          }
        }
        const batchSize = 500;
        for (let i = 0; i < allMembers.length; i += batchSize) {
          let batch = allMembers.slice(i, i + batchSize);
          // Deduplicate using run_guid, character_name
          const seen = new Set();
          batch = batch.filter(row => {
            const key = `${row[0]}|${row[1]}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (batch.length === 0) continue;
          const values = [];
          const placeholders = [];
          let idx = 1;
          for (const row of batch) {
            placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
            values.push(...row);
          }
          await client.query(
            `INSERT INTO run_group_member (run_guid, character_name, class_id, spec_id, role)
             VALUES ${placeholders.join(',')}
             ON CONFLICT (run_guid, character_name) DO UPDATE SET
               class_id = EXCLUDED.class_id,
               spec_id = EXCLUDED.spec_id,
               role = EXCLUDED.role;`,
            values
          );
        }
        await client.query('COMMIT');
        //console.log(`[IMPORT ALL] Import complete for file: ${filename}`);
        return { filename, runs: runs.length, members: allMembers.length };
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
    res.json({ status: 'OK', totalRuns, totalMembers, results });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Bulk COPY import endpoint ---
router.post('/import-leaderboard-copy', async (req, res) => {
  try {
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      return res.status(404).json({ status: 'NOT OK', error: 'Output directory not found' });
    }
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }
    console.log(`[COPY IMPORT] Starting bulk import for ${files.length} files...`);
    let totalRuns = 0;
    let totalMembers = 0;
    let results = [];
    const pool = db.pool;
    let completed = 0;
    // Deduplicate runs across all files before writing CSVs
    const allRuns = [];
    const allMembers = [];
    const runKeySet = new Set();
    for (const filename of files) {
      const filePath = path.join(outputDir, filename);
      const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      for (const run of runs) {
        const key = [
          run.dungeon_id,
          run.period_id,
          run.season_id,
          run.region,
          run.completed_at,
          run.duration_ms,
          run.keystone_level,
          run.score
        ].join('|');
        if (!runKeySet.has(key)) {
          runKeySet.add(key);
          allRuns.push({ run, filename });
          if (run.members && run.members.length > 0) {
            for (const m of run.members) {
              allMembers.push({ member: m, run_guid: run.run_guid });
            }
          }
        }
      }
    }
    // Now write deduplicated runs and members to CSVs and import as before
    for (const filename of files) {
      // Filter allRuns for this file
      const runsForFile = allRuns.filter(obj => obj.filename === filename).map(obj => obj.run);
      const filePath = path.join(outputDir, filename);
      const runsCsvPath = path.join(os.tmpdir(), `runs-${filename}.csv`);
      const membersCsvPath = path.join(os.tmpdir(), `members-${filename}.csv`);
      const runsCsv = fs.createWriteStream(runsCsvPath);
      const membersCsv = fs.createWriteStream(membersCsvPath);
      let runRows = 0;
      let memberRows = 0;
      for (const run of runsForFile) {
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
        runRows++;
        if (run.members && run.members.length > 0) {
          for (const m of run.members) {
            membersCsv.write([
              m.character_name,
              m.class_id,
              m.spec_id,
              m.role,
              run.run_guid
            ].map(x => x === undefined ? '' : x).join(',') + '\n');
            memberRows++;
          }
        }
      }
      runsCsv.end();
      membersCsv.end();
      await Promise.all([
        new Promise(resolve => runsCsv.on('finish', resolve)),
        new Promise(resolve => membersCsv.on('finish', resolve))
      ]);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await new Promise((resolve, reject) => {
          const stream = client.query(copyFrom(`COPY leaderboard_run (region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid) FROM STDIN WITH (FORMAT csv)`));
          const fileStream = fs.createReadStream(runsCsvPath);
          pipeline(fileStream, stream, err => err ? reject(err) : resolve());
        });
        // COPY to staging table instead of run_group_member
        await new Promise((resolve, reject) => {
          const stream = client.query(copyFrom(`COPY run_group_member_staging (character_name, class_id, spec_id, role, run_guid) FROM STDIN WITH (FORMAT csv)`));
          const fileStream = fs.createReadStream(membersCsvPath);
          pipeline(fileStream, stream, err => err ? reject(err) : resolve());
        });
        // Upsert from staging to real table
        await client.query(`
          INSERT INTO run_group_member (run_guid, character_name, class_id, spec_id, role)
          SELECT DISTINCT ON (run_guid, character_name) run_guid, character_name, class_id, spec_id, role
          FROM run_group_member_staging
          ON CONFLICT (run_guid, character_name) DO UPDATE SET
            class_id = EXCLUDED.class_id,
            spec_id = EXCLUDED.spec_id,
            role = EXCLUDED.role;
        `);
        // Truncate staging table
        await client.query('TRUNCATE run_group_member_staging;');
        await client.query('COMMIT');
        //console.log(`[COPY IMPORT] File complete: ${filename} (runs: ${runRows}, members: ${memberRows})`);
        results.push({ filename, runs: runRows, members: memberRows });
        totalRuns += runRows;
        totalMembers += memberRows;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[COPY IMPORT ERROR] File: ${filename} error: ${err.message}`);
        results.push({ filename, error: err.message });
      } finally {
        client.release();
        fs.unlinkSync(runsCsvPath);
        fs.unlinkSync(membersCsvPath);
        completed++;
        const percent = Math.min((completed / files.length) * 100, 100).toFixed(1);
        const barLength = 20;
        const filled = Math.min(Math.round((completed / files.length) * barLength), barLength);
        const empty = Math.max(barLength - filled, 0);
        const bar = '[' + '#'.repeat(filled) + '-'.repeat(empty) + ']';
        console.log(`[COPY IMPORT] Progress: ${bar} ${completed}/${files.length} files (${percent}%)`);
      }
    }
    console.log(`[COPY IMPORT] Bulk import complete. Total runs: ${totalRuns}, total members: ${totalMembers}`);
    res.json({ status: 'OK', totalRuns, totalMembers, results });
  } catch (error) {
    console.error('[COPY IMPORT ERROR]', error);
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

// --- Clear output directory endpoint ---
router.post('/clear-output', async (req, res) => {
  const outputDir = path.join(__dirname, '../output');
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ status: 'NOT OK', error: 'Not allowed in production' });
  }
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
  try {
    await db.pool.query('REFRESH MATERIALIZED VIEW top_keys_per_group;');
    await db.pool.query('REFRESH MATERIALIZED VIEW top_keys_global;');
    await db.pool.query('REFRESH MATERIALIZED VIEW top_keys_per_period;');
    await db.pool.query('REFRESH MATERIALIZED VIEW top_keys_per_dungeon;');
    res.json({ status: 'OK', message: 'All materialized views refreshed.' });
  } catch (error) {
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

module.exports = router;
module.exports.populateDungeons = populateDungeons;
module.exports.populateSeasons = populateSeasons;
module.exports.populatePeriods = populatePeriods;
module.exports.populateRealms = populateRealms; 