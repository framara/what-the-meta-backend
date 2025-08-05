#!/usr/bin/env node
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const pool = new Pool({
  // Use environment variables for connection
});

async function runMaintenance() {
  const client = await pool.connect();
  try {
    console.log('Starting database maintenance...');

    // 1. Update table statistics
    console.log('Analyzing tables...');
    await client.query('ANALYZE VERBOSE');

    // 2. Refresh materialized views
    console.log('Refreshing materialized views...');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_group');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_global');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_period');
    await client.query('REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_dungeon');

    // 3. Clean up dead tuples
    console.log('Vacuuming tables...');
    await client.query('VACUUM (ANALYZE, VERBOSE) leaderboard_run');
    await client.query('VACUUM (ANALYZE, VERBOSE) run_group_member');

    // 4. Get database stats
    const stats = await client.query(`
      SELECT 
        schemaname,
        tablename,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        last_vacuum,
        last_analyze
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
    `);

    console.log('\nTable Statistics:');
    console.table(stats.rows);

    console.log('Maintenance completed successfully!');
  } catch (err) {
    console.error('Error during maintenance:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMaintenance()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runMaintenance };