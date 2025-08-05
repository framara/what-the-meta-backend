const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  max: 20,               // Increased pool size
  min: 4,                // Minimum idle connections
  idleTimeoutMillis: 60000,  // Close idle connections after 60s
  connectionTimeoutMillis: 2000,  // Connection timeout
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

// Upsert leaderboard_run (no group_id)
async function upsertLeaderboardRun(run) {
  const query = `
    INSERT INTO leaderboard_run
      (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level, score, rank)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    ON CONFLICT (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level)
    DO UPDATE SET
      score = EXCLUDED.score,
      rank = EXCLUDED.rank;
  `;
  const values = [
    run.dungeon_id,
    run.period_id,
    run.realm_id,
    run.season_id,
    run.region,
    run.completed_at,
    run.duration_ms,
    run.keystone_level,
    run.score,
    run.rank,
  ];
  try {
    await pool.query(query, values);
    return { ok: true };
  } catch (err) {
    console.error('DB upsert error:', err);
    return { ok: false, error: err };
  }
}

// Insert run_group_member records for a run
async function insertRunGroupMembers(run_id, members) {
  if (!members || members.length === 0) return { ok: true };
  const values = [];
  const placeholders = [];
  let idx = 1;
  let unknownCount = 0;
  for (const m of members) {
    // Use 'unknown' for null or empty character names
    const characterName = (!m.character_name || m.character_name.trim() === '') ? 'unknown' : m.character_name;
    if (characterName === 'unknown') {
      unknownCount++;
    }
    placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
    values.push(run_id, characterName, m.class_id, m.spec_id, m.role);
  }
  if (unknownCount > 0) {
    console.log(`[DB] Used 'unknown' for ${unknownCount} members with null/empty character names for run_id: ${run_id}`);
  }
  const query = `
    INSERT INTO run_group_member (run_id, character_name, class_id, spec_id, role)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (run_id, character_name) DO UPDATE SET
      class_id = EXCLUDED.class_id,
      spec_id = EXCLUDED.spec_id,
      role = EXCLUDED.role;
  `;
  try {
    await pool.query(query, values);
    return { ok: true };
  } catch (err) {
    console.error('DB insert run_group_member error:', err);
    return { ok: false, error: err };
  }
}

module.exports = {
  pool,
  upsertLeaderboardRun,
  insertRunGroupMembers,
};