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

// Import the automation functions
const automation = require('../../scripts/render-automation');

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
        for (const run of runs) {
          if (run.members && run.members.length > 0 && successfulRunGuids.has(run.run_guid)) {
            for (const m of run.members) {
              membersCsv.write([
                run.run_guid,
                m.character_name,
                m.class_id,
                m.spec_id,
                m.role
              ].map(x => x === undefined ? '' : x).join(',') + '\n');
              memberCount++;
            }
          }
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

// Cleanup endpoint: keep only top 1000 runs per (dungeon_id, period_id, season_id)
router.post('/cleanup-leaderboard', async (req, res) => {
  const { season_id } = req.body || {};
  let sql = `
    DELETE FROM leaderboard_run
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY season_id, period_id, dungeon_id
            ORDER BY keystone_level DESC, score DESC
          ) AS rn
        FROM leaderboard_run
        ${season_id ? 'WHERE season_id = $1' : ''}
      ) sub
      WHERE rn > 1000
    );
  `;
  try {
    const result = season_id
      ? await db.pool.query(sql, [season_id])
      : await db.pool.query(sql);
    res.json({ status: 'OK', rows_deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ status: 'ERROR', error: err.message });
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

// POST /admin/vacuum-full - Perform VACUUM FULL on the database
router.post('/vacuum-full', async (req, res) => {
  try {
    console.log('[ADMIN] VACUUM FULL started');
    
    // VACUUM FULL requires exclusive access and can take a long time
    // It's recommended to run this during low-traffic periods
    const result = await db.pool.query('VACUUM FULL');
    
    console.log('[ADMIN] VACUUM FULL completed');
    
    res.json({
      status: 'OK',
      message: 'VACUUM FULL completed successfully',
      result: result
    });
  } catch (error) {
    console.error('[ADMIN ERROR] VACUUM FULL failed:', error.message);
    res.status(500).json({ status: 'NOT OK', error: error.message });
  }
});

module.exports = router;
module.exports.populateDungeons = populateDungeons;
module.exports.populateSeasons = populateSeasons;
module.exports.populatePeriods = populatePeriods;
module.exports.populateRealms = populateRealms;