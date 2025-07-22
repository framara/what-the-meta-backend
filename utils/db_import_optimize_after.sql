-- Run AFTER import to restore durability

-- Only wrap LOGGED/UNLOGGED changes in a transaction
BEGIN;
ALTER TABLE run_group_member SET LOGGED;
ALTER TABLE leaderboard_run SET LOGGED;
COMMIT;

-- Recreate indexes (run outside transaction)
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_dungeon_period_region ON leaderboard_run(dungeon_id, period_id, region);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_dungeon ON leaderboard_run(dungeon_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_period ON leaderboard_run(period_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_realm ON leaderboard_run(realm_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_region ON leaderboard_run(region);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season ON leaderboard_run(season_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_score ON leaderboard_run(score);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season_dungeon_keylevel ON leaderboard_run(season_id, dungeon_id, keystone_level DESC, duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season_period_dungeon_keylevel ON leaderboard_run(season_id, period_id, dungeon_id, keystone_level DESC, duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_run_group_member_character_name ON run_group_member(character_name);
-- Recreate materialized view indexes
CREATE INDEX IF NOT EXISTS idx_top_keys_season_period_dungeon_score ON top_keys_per_group(season_id, period_id, dungeon_id, keystone_level DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_top_keys_global_season ON top_keys_global(season_id, keystone_level DESC, score DESC);
CREATE INDEX IF NOT EXISTS idx_top_keys_per_period ON top_keys_per_period(season_id, period_id, keystone_level DESC, score DESC);

-- Refresh materialized views (run outside transaction)
REFRESH MATERIALIZED VIEW top_keys_per_group;
REFRESH MATERIALIZED VIEW top_keys_global;
REFRESH MATERIALIZED VIEW top_keys_per_period; 