-- Clean slate schema for WoW Leaderboard DB
-- Drops all relevant tables before recreating them

-- Drop tables in dependency order
DROP TABLE IF EXISTS run_group_member CASCADE;
DROP TABLE IF EXISTS leaderboard_run CASCADE;
DROP TABLE IF EXISTS dungeon CASCADE;
DROP TABLE IF EXISTS period CASCADE;
DROP TABLE IF EXISTS realm CASCADE;
DROP TABLE IF EXISTS season CASCADE;

-- Create tables

CREATE TABLE public.dungeon (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE public.period (
    id integer NOT NULL,
    season_id integer,
    start_date date,
    end_date date,
    PRIMARY KEY (id)
);

CREATE TABLE public.realm (
    id integer NOT NULL,
    name character varying(128) NOT NULL,
    region character varying(8) NOT NULL,
    PRIMARY KEY (id)
);

CREATE TABLE public.season (
    id integer NOT NULL,
    name character varying(64) NOT NULL,
    start_date date,
    end_date date,
    PRIMARY KEY (id)
);

CREATE TABLE public.leaderboard_run (
    id serial PRIMARY KEY,
    region character varying(8),
    season_id integer,
    period_id integer,
    dungeon_id integer,
    realm_id integer,
    completed_at timestamp without time zone,
    duration_ms integer,
    keystone_level integer,
    score double precision,
    rank integer,
    UNIQUE (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
);

CREATE TABLE public.run_group_member (
    run_id integer NOT NULL REFERENCES public.leaderboard_run(id) ON DELETE CASCADE,
    character_name character varying(64) NOT NULL,
    class_id integer,
    spec_id integer,
    role character varying(16),
    PRIMARY KEY (run_id, character_name)
);

-- Foreign keys
ALTER TABLE ONLY public.leaderboard_run
    ADD CONSTRAINT leaderboard_run_dungeon_id_fkey FOREIGN KEY (dungeon_id) REFERENCES public.dungeon(id);
ALTER TABLE ONLY public.leaderboard_run
    ADD CONSTRAINT leaderboard_run_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.period(id);
ALTER TABLE ONLY public.leaderboard_run
    ADD CONSTRAINT leaderboard_run_realm_id_fkey FOREIGN KEY (realm_id) REFERENCES public.realm(id);
ALTER TABLE ONLY public.leaderboard_run
    ADD CONSTRAINT leaderboard_run_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.season(id);
ALTER TABLE ONLY public.period
    ADD CONSTRAINT period_season_id_fkey FOREIGN KEY (season_id) REFERENCES public.season(id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_run_group_member_character_name ON run_group_member(character_name);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_dungeon_period_region ON leaderboard_run(dungeon_id, period_id, region);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_dungeon ON leaderboard_run(dungeon_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_period ON leaderboard_run(period_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_realm ON leaderboard_run(realm_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_region ON leaderboard_run(region);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season ON leaderboard_run(season_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_score ON leaderboard_run(score);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season_dungeon_keylevel ON leaderboard_run(season_id, dungeon_id, keystone_level DESC, duration_ms ASC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_run_season_period_dungeon_keylevel ON leaderboard_run(season_id, period_id, dungeon_id, keystone_level DESC, duration_ms ASC);
-- End of clean slate schema

-- Materialized view for top keys per group (ranked by keystone_level DESC, score DESC)
CREATE MATERIALIZED VIEW IF NOT EXISTS top_keys_per_group AS
WITH ranked_runs AS (
  SELECT
    lr.*,
    ROW_NUMBER() OVER (
      PARTITION BY lr.season_id, lr.period_id, lr.dungeon_id
      ORDER BY lr.keystone_level DESC, lr.score DESC
    ) AS rn
  FROM leaderboard_run lr
)
SELECT
  r.*,
  (
    SELECT json_agg(json_build_object(
      'character_name', rgm.character_name,
      'class_id', rgm.class_id,
      'spec_id', rgm.spec_id,
      'role', rgm.role
    ) ORDER BY rgm.character_name)
    FROM run_group_member rgm
    WHERE rgm.run_id = r.id
  ) AS members
FROM ranked_runs r
WHERE r.rn <= 100;

-- Index for fast filtering and ordering on the materialized view
CREATE INDEX IF NOT EXISTS idx_top_keys_season_period_dungeon_score
  ON top_keys_per_group(season_id, period_id, dungeon_id, keystone_level DESC, score DESC);

-- NOTE: Refresh this view after importing new leaderboard data:
-- REFRESH MATERIALIZED VIEW top_keys_per_group;

-- Materialized view for top keys globally per season (no period_id or dungeon_id)
CREATE MATERIALIZED VIEW IF NOT EXISTS top_keys_global AS
WITH ranked_runs AS (
  SELECT
    lr.*,
    ROW_NUMBER() OVER (
      PARTITION BY lr.season_id
      ORDER BY lr.keystone_level DESC, lr.score DESC
    ) AS rn
  FROM leaderboard_run lr
)
SELECT
  r.*,
  (
    SELECT json_agg(json_build_object(
      'character_name', rgm.character_name,
      'class_id', rgm.class_id,
      'spec_id', rgm.spec_id,
      'role', rgm.role
    ) ORDER BY rgm.character_name)
    FROM run_group_member rgm
    WHERE rgm.run_id = r.id
  ) AS members
FROM ranked_runs r
WHERE r.rn <= 100;

-- Index for fast filtering and ordering on the global materialized view
CREATE INDEX IF NOT EXISTS idx_top_keys_global_season
  ON top_keys_global(season_id, keystone_level DESC, score DESC);

-- NOTE: Refresh this view after importing new leaderboard data:
-- REFRESH MATERIALIZED VIEW top_keys_global;

-- Materialized view for top keys per (season_id, period_id) (no dungeon_id)
CREATE MATERIALIZED VIEW IF NOT EXISTS top_keys_per_period AS
WITH ranked_runs AS (
  SELECT
    lr.*,
    ROW_NUMBER() OVER (
      PARTITION BY lr.season_id, lr.period_id
      ORDER BY lr.keystone_level DESC, lr.score DESC
    ) AS rn
  FROM leaderboard_run lr
)
SELECT
  r.*,
  (
    SELECT json_agg(json_build_object(
      'character_name', rgm.character_name,
      'class_id', rgm.class_id,
      'spec_id', rgm.spec_id,
      'role', rgm.role
    ) ORDER BY rgm.character_name)
    FROM run_group_member rgm
    WHERE rgm.run_id = r.id
  ) AS members
FROM ranked_runs r
WHERE r.rn <= 100;

-- Index for fast filtering and ordering on the per-period materialized view
CREATE INDEX IF NOT EXISTS idx_top_keys_per_period
  ON top_keys_per_period(season_id, period_id, keystone_level DESC, score DESC);

-- NOTE: Refresh this view after importing new leaderboard data:
-- REFRESH MATERIALIZED VIEW top_keys_per_period;

