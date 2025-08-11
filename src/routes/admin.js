const express = require('express');
const proxyService = require('../services/proxy');
const db = require('../services/db');
const { getAllRegions } = require('../config/regions');
const fs = require('fs');
const path = require('path');
const { WOW_SPECIALIZATIONS, WOW_SPEC_ROLES, SEASON_METADATA } = require('../config/constants');

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
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
      return res.status(404).json({ status: 'NOT OK', error: 'No JSON files found in output directory' });
    }

    console.log(`[IMPORT ALL FAST] Starting optimized bulk import for ${files.length} files...`);
    let totalRuns = 0;
    let totalMembers = 0;
    let results = [];

    // Use a single connection pool with higher limits
    const pool = db.pool;
    const BATCH_SIZE = 50; // Process 50 files per batch
    const CONCURRENT_TASKS = 8; // Increased from 4 to 8 for better throughput
    const limit = pLimit(CONCURRENT_TASKS);

    let completed = 0;
    const totalFiles = files.length;

    // Process files in batches
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batchFiles = files.slice(i, i + BATCH_SIZE);
      console.log(`[IMPORT ALL FAST] Processing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(files.length/BATCH_SIZE)}`);

      // Create a single temporary CSV for the entire batch
      const batchRunsCsvPath = path.join(os.tmpdir(), `batch-runs-${Date.now()}.csv`);
      const batchMembersCsvPath = path.join(os.tmpdir(), `batch-members-${Date.now()}.csv`);
      const batchRunsCsv = fs.createWriteStream(batchRunsCsvPath);
      const batchMembersCsv = fs.createWriteStream(batchMembersCsvPath);

      // Process each file in the batch concurrently
      const batchTasks = batchFiles.map(filename => limit(async () => {
        const filePath = path.join(outputDir, filename);
        let fileRuns = 0;
        let fileMembers = 0;

        try {
          const runs = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          fileRuns = runs.length;

          // Write runs to the batch CSV
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

            // Write members to the batch CSV
            if (run.members && run.members.length > 0) {
              for (const m of run.members) {
                // Use 'unknown' for null or empty character names
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
          printFileImportProgress(completed, totalFiles);
          return { filename, runs: fileRuns, members: fileMembers };

        } catch (err) {
          console.error(`[IMPORT ALL FAST ERROR] File: ${filename}`, err);
          return { filename, error: err.message };
        }
      }));

      // Wait for all files in the batch to be processed
      const batchResults = await Promise.allSettled(batchTasks);
      
      // Close the CSV streams
      batchRunsCsv.end();
      batchMembersCsv.end();

      // Wait for CSV files to be fully written
      await Promise.all([
        new Promise(resolve => batchRunsCsv.on('finish', resolve)),
        new Promise(resolve => batchMembersCsv.on('finish', resolve))
      ]);

      // Now process the entire batch in a single transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Create temporary tables for this batch
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

        // Bulk copy the batch data
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

        // Insert runs from temp table using a more efficient query
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

        // Insert members with better deduplication
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

        // Update totals and results
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

      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[IMPORT ALL FAST ERROR] Batch processing error:`, err);
        throw err;
      } finally {
        client.release();

        // Clean up batch CSV files
        try {
          fs.unlinkSync(batchRunsCsvPath);
          fs.unlinkSync(batchMembersCsvPath);
        } catch (err) {
          console.warn(`[IMPORT ALL FAST] Warning: Could not delete temporary files:`, err.message);
        }
      }
    }

    console.log(`[IMPORT ALL FAST] Bulk import complete. Total runs: ${totalRuns}, total members: ${totalMembers}`);
    res.json({ status: 'OK', totalRuns, totalMembers, results });

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
  try {
    // Use CONCURRENTLY refresh to allow views to remain available during refresh
    await db.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_group;');
    await db.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_global;');
    await db.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_period;');
    await db.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_dungeon;');
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