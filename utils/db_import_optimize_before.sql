-- Run BEFORE import to optimize bulk loading

-- Drop non-unique indexes
DROP INDEX IF EXISTS idx_leaderboard_run_dungeon_period_region;
DROP INDEX IF EXISTS idx_leaderboard_run_dungeon;
DROP INDEX IF EXISTS idx_leaderboard_run_period;
DROP INDEX IF EXISTS idx_leaderboard_run_realm;
DROP INDEX IF EXISTS idx_leaderboard_run_region;
DROP INDEX IF EXISTS idx_leaderboard_run_season;
DROP INDEX IF EXISTS idx_leaderboard_run_score;
DROP INDEX IF EXISTS idx_leaderboard_run_season_dungeon_keylevel;
DROP INDEX IF EXISTS idx_leaderboard_run_season_period_dungeon_keylevel;
DROP INDEX IF EXISTS idx_run_group_member_character_name;
-- Drop materialized view indexes if you want to refresh them after import
DROP INDEX IF EXISTS idx_top_keys_season_period_dungeon_score;
DROP INDEX IF EXISTS idx_top_keys_global_season;
DROP INDEX IF EXISTS idx_top_keys_per_period;

-- Set both tables to UNLOGGED in a single transaction
BEGIN;
ALTER TABLE run_group_member SET UNLOGGED;
ALTER TABLE leaderboard_run SET UNLOGGED;
COMMIT; 