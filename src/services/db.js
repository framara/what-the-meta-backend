const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  // Pool sizing and timeouts (env-overridable)
  max: Number(process.env.PG_POOL_MAX ?? 20), // maximum clients in the pool
  min: Number(process.env.PG_POOL_MIN ?? 4),  // minimum idle clients
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000), // 30s
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 10000), // 10s
  keepAlive: true, // enable TCP keepalive to reduce idle disconnects
  // SSL: prefer PGSSLMODE=require in production
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
});

// Prevent process crash on background/idle client errors
pool.on('error', (err) => {
  console.error('[pg] Unexpected error on idle client', err);
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
  async upsertRaiderioDungeon(d) {
    const q = `
      INSERT INTO raiderio_dungeon (id, slug, name, short_name, expansion_id)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET
        slug = EXCLUDED.slug,
        name = EXCLUDED.name,
        short_name = EXCLUDED.short_name,
        expansion_id = EXCLUDED.expansion_id
    `;
    await pool.query(q, [d.id, d.slug, d.name, d.short_name || null, d.expansion_id || null]);
  },
  async upsertRaiderioSeason(s) {
    const q = `
      INSERT INTO raiderio_season (slug, name, expansion_id, start_ts, end_ts)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        expansion_id = EXCLUDED.expansion_id,
        start_ts = COALESCE(EXCLUDED.start_ts, raiderio_season.start_ts),
        end_ts = COALESCE(EXCLUDED.end_ts, raiderio_season.end_ts)
    `;
    await pool.query(q, [s.slug, s.name || s.slug, s.expansion_id || null, s.start_ts || null, s.end_ts || null]);
  },
  async ensureRaiderioCutoffTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raiderio_cutoff_snapshot (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        season_slug TEXT NOT NULL,
        region TEXT NOT NULL,
        cutoff_score NUMERIC,
        target_count INTEGER,
        total_qualifying INTEGER,
        source_pages INTEGER,
        dungeon_count INTEGER,
        distribution JSONB
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS raiderio_cutoff_player (
        snapshot_id INTEGER NOT NULL REFERENCES raiderio_cutoff_snapshot(id) ON DELETE CASCADE,
        region TEXT NOT NULL,
        realm_slug TEXT NOT NULL,
        name TEXT NOT NULL,
        class TEXT,
        spec TEXT,
        score NUMERIC,
        UNIQUE(snapshot_id, region, realm_slug, name)
      );
    `);
  },
  async insertCutoffSnapshot({ season_slug, region, cutoff_score, target_count, total_qualifying, source_pages, dungeon_count, distribution }) {
    const { rows } = await pool.query(
      `INSERT INTO raiderio_cutoff_snapshot (season_slug, region, cutoff_score, target_count, total_qualifying, source_pages, dungeon_count, distribution)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [season_slug, region, cutoff_score ?? null, target_count ?? null, total_qualifying ?? null, source_pages ?? null, dungeon_count ?? null, distribution ? JSON.stringify(distribution) : null]
    );
    return rows[0].id;
  },
  async bulkInsertCutoffPlayers(snapshot_id, players) {
    if (!players || players.length === 0) return { ok: true, inserted: 0 };
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const p of players) {
      placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      values.push(snapshot_id, p.region, p.realm_slug, p.name, p.class, p.spec, p.score);
    }
    await pool.query(
      `INSERT INTO raiderio_cutoff_player (snapshot_id, region, realm_slug, name, class, spec, score)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (snapshot_id, region, realm_slug, name) DO UPDATE SET
         class = EXCLUDED.class,
         spec = EXCLUDED.spec,
         score = EXCLUDED.score`,
      values
    );
    return { ok: true, inserted: players.length };
  },
  async getLatestCutoffSnapshot(season_slug, region) {
    const { rows } = await pool.query(
      `SELECT id, created_at, season_slug, region, cutoff_score, target_count, total_qualifying, source_pages, dungeon_count, distribution
       FROM raiderio_cutoff_snapshot
       WHERE season_slug = $1 AND region = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [season_slug, region]
    );
    return rows[0] || null;
  },
  async getLatestCutoffSnapshotsIndex() {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (season_slug, region)
         season_slug, region, id, created_at, cutoff_score, target_count, total_qualifying
       FROM raiderio_cutoff_snapshot
       ORDER BY season_slug, region, created_at DESC`
    );
    return rows;
  },
  async getLatestCutoffSnapshotsBySeason(season_slug) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (region)
         season_slug, region, id, created_at, cutoff_score, target_count, total_qualifying, distribution
       FROM raiderio_cutoff_snapshot
       WHERE season_slug = $1
       ORDER BY region, created_at DESC`,
      [season_slug]
    );
    return rows;
  }
};