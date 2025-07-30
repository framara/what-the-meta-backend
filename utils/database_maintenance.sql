-- =====================================================
-- WoW Leaderboard Database Maintenance Script
-- =====================================================
-- This script contains all the essential database maintenance operations
-- for the WoW Leaderboard application.

-- =====================================================
-- 1. MONITORING QUERIES
-- =====================================================

-- Index usage statistics
-- Run this to see which indexes are being used and their performance
SELECT 
    schemaname,
    relname as tablename,
    indexrelname as indexname,
    idx_scan as number_of_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched,
    pg_size_pretty(pg_relation_size(schemaname || '.' || indexrelname::text)) as index_size,
    CASE WHEN idx_scan > 0 
         THEN pg_size_pretty((pg_relation_size(schemaname || '.' || indexrelname::text) / idx_scan)::bigint)
         ELSE 'Infinity'
    END as size_per_scan
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Table sizes and bloat estimation
SELECT
    schemaname,
    relname as tablename,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) as total_size,
    pg_size_pretty(pg_table_size(schemaname || '.' || relname)) as table_size,
    pg_size_pretty(pg_indexes_size(schemaname || '.' || relname)) as index_size,
    CASE 
        WHEN pg_total_relation_size(schemaname || '.' || relname) > 0 
        THEN round(100 * pg_table_size(schemaname || '.' || relname)::numeric / pg_total_relation_size(schemaname || '.' || relname), 2)
        ELSE 0
    END as table_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC;

-- =====================================================
-- 2. CLEANUP OPERATIONS
-- =====================================================

-- Drop unused indexes to free up space (run when needed)
-- This will free up approximately 2.5GB of space
/*
DROP INDEX IF EXISTS idx_leaderboard_run_season;
DROP INDEX IF EXISTS idx_leaderboard_run_score;
DROP INDEX IF EXISTS idx_leaderboard_run_period;
DROP INDEX IF EXISTS idx_leaderboard_run_dungeon;
DROP INDEX IF EXISTS idx_leaderboard_run_region;
DROP INDEX IF EXISTS idx_run_group_member_character_name;
DROP INDEX IF EXISTS leaderboard_run_dungeon_id_period_id_season_id_region_compl_key;
DROP INDEX IF EXISTS leaderboard_run_run_guid_key;
DROP INDEX IF EXISTS leaderboard_run_pkey;
DROP INDEX IF EXISTS idx_top_keys_per_period;
DROP INDEX IF EXISTS idx_top_keys_per_dungeon;
DROP INDEX IF EXISTS idx_top_keys_season_period_dungeon_score;
DROP INDEX IF EXISTS idx_top_keys_global_season;
*/

-- =====================================================
-- 3. OPTIMIZATION OPERATIONS
-- =====================================================

-- Add missing indexes for materialized views (run once)
-- This should reduce refresh time from 6 minutes to under 1 minute
/*
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_group_lookup ON top_keys_per_group 
  (season_id, period_id, dungeon_id, keystone_level DESC, score DESC)
  INCLUDE (id, run_guid, completed_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_period_lookup ON top_keys_per_period 
  (season_id, period_id, keystone_level DESC, score DESC)
  INCLUDE (id, run_guid, completed_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_dungeon_lookup ON top_keys_per_dungeon 
  (season_id, dungeon_id, keystone_level DESC, score DESC)
  INCLUDE (id, run_guid, completed_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_global_lookup ON top_keys_global 
  (season_id, keystone_level DESC, score DESC)
  INCLUDE (id, run_guid, completed_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_group_time ON top_keys_per_group 
  (completed_at DESC)
  INCLUDE (season_id, period_id, dungeon_id, keystone_level, score);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_period_time ON top_keys_per_period 
  (completed_at DESC)
  INCLUDE (season_id, period_id, keystone_level, score);
*/

-- Add unique indexes for CONCURRENTLY refresh (run once)
/*
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_group_unique_id ON top_keys_per_group (id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_global_unique_id ON top_keys_global (id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_period_unique_id ON top_keys_per_period (id);
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_top_keys_per_dungeon_unique_id ON top_keys_per_dungeon (id);
*/

-- Add cleanup-specific index (run once)
/*
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cleanup_leaderboard_runs ON leaderboard_run 
  (season_id, period_id, dungeon_id, keystone_level DESC, score DESC)
  INCLUDE (id);
*/

-- =====================================================
-- 4. REFRESH OPERATIONS
-- =====================================================

-- Refresh all materialized views with CONCURRENTLY (recommended)
-- This allows views to remain available during refresh
\timing on

SELECT 'Refreshing materialized views with CONCURRENTLY...' as status;

SELECT 'Refreshing top_keys_global...' as status;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_global;

SELECT 'Refreshing top_keys_per_dungeon...' as status;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_dungeon;

SELECT 'Refreshing top_keys_per_period...' as status;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_period;

SELECT 'Refreshing top_keys_per_group...' as status;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_group;

SELECT 'All CONCURRENTLY refreshes complete!' as status;

-- Show final sizes
SELECT 
    matviewname,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || matviewname)) as total_size,
    pg_size_pretty(pg_table_size(schemaname || '.' || matviewname)) as table_size,
    pg_size_pretty(pg_indexes_size(schemaname || '.' || matviewname)) as index_size
FROM pg_matviews 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || matviewname) DESC;

-- =====================================================
-- 5. MAINTENANCE OPERATIONS
-- =====================================================

-- Analyze tables for better query planning (run periodically)
ANALYZE VERBOSE leaderboard_run;
ANALYZE VERBOSE run_group_member;
ANALYZE top_keys_per_group;
ANALYZE top_keys_per_period;
ANALYZE top_keys_per_dungeon;
ANALYZE top_keys_global;

-- Vacuum tables to clean up dead tuples (run periodically)
VACUUM (ANALYZE, VERBOSE) leaderboard_run;
VACUUM (ANALYZE, VERBOSE) run_group_member;

-- =====================================================
-- 6. PERFORMANCE TESTING
-- =====================================================

-- Test cleanup query performance
EXPLAIN (ANALYZE, BUFFERS) 
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
    WHERE season_id = 14
  ) sub
  WHERE rn > 1000
);

-- Test materialized view query performance
EXPLAIN (ANALYZE, BUFFERS) 
SELECT COUNT(*) FROM top_keys_per_group; 