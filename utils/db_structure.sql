-- Clean slate schema for WoW Leaderboard DB
-- Drops all relevant tables before recreating them

-- Drop tables in dependency order
DROP TABLE IF EXISTS run_group_member CASCADE;
DROP TABLE IF EXISTS leaderboard_run CASCADE;
DROP TABLE IF EXISTS season_dungeon CASCADE;
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

-- Mapping of season to its active dungeons (DB-driven instead of hardcoding)
CREATE TABLE public.season_dungeon (
    season_id integer NOT NULL REFERENCES public.season(id) ON DELETE CASCADE,
    dungeon_id integer NOT NULL REFERENCES public.dungeon(id) ON DELETE RESTRICT,
    PRIMARY KEY (season_id, dungeon_id)
);

CREATE TABLE public.leaderboard_run (
    id serial PRIMARY KEY,
    run_guid uuid UNIQUE,
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
    run_guid uuid REFERENCES public.leaderboard_run(run_guid) ON DELETE CASCADE,
    character_name character varying(64) NOT NULL,
    class_id integer,
    spec_id integer,
    role character varying(16),
    PRIMARY KEY (run_guid, character_name)
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

-- Optimized indexes for performance
CREATE INDEX idx_cleanup_leaderboard_runs ON public.leaderboard_run USING btree (season_id, period_id, dungeon_id, keystone_level DESC, score DESC) INCLUDE (id);
CREATE INDEX idx_leaderboard_run_season_dungeon_keylevel ON public.leaderboard_run USING btree (season_id, dungeon_id, keystone_level DESC, score);
CREATE INDEX idx_leaderboard_run_season_period_dungeon_keylevel ON public.leaderboard_run USING btree (season_id, period_id, dungeon_id, keystone_level DESC, score DESC);

-- Materialized view for top keys per group (optimized with JOIN instead of subquery)
CREATE MATERIALIZED VIEW public.top_keys_per_group AS
WITH ranked_runs AS (
  SELECT lr.id,
         lr.run_guid,
         lr.region,
         lr.season_id,
         lr.period_id,
         lr.dungeon_id,
         lr.realm_id,
         lr.completed_at,
         lr.duration_ms,
         lr.keystone_level,
         lr.score,
         lr.rank,
         row_number() OVER (PARTITION BY lr.season_id, lr.period_id, lr.dungeon_id ORDER BY lr.keystone_level DESC, lr.score DESC) AS rn
  FROM public.leaderboard_run lr
),
runs_with_members AS (
  SELECT 
    r.id,
    r.run_guid,
    r.region,
    r.season_id,
    r.period_id,
    r.dungeon_id,
    r.realm_id,
    r.completed_at,
    r.duration_ms,
    r.keystone_level,
    r.score,
    r.rank,
    r.rn,
    json_agg(json_build_object('character_name', rgm.character_name, 'class_id', rgm.class_id, 'spec_id', rgm.spec_id, 'role', rgm.role) ORDER BY rgm.character_name) FILTER (WHERE (rgm.character_name IS NOT NULL)) AS members
  FROM ranked_runs r
  LEFT JOIN public.run_group_member rgm ON (r.run_guid = rgm.run_guid)
  WHERE (r.rn <= 1000)
  GROUP BY r.id, r.run_guid, r.region, r.season_id, r.period_id, r.dungeon_id, r.realm_id, r.completed_at, r.duration_ms, r.keystone_level, r.score, r.rank, r.rn
)
SELECT id,
       run_guid,
       region,
       season_id,
       period_id,
       dungeon_id,
       realm_id,
       completed_at,
       duration_ms,
       keystone_level,
       score,
       rank,
       rn,
       members
FROM runs_with_members;

-- Materialized view for top keys globally per season
CREATE MATERIALIZED VIEW public.top_keys_global AS
WITH ranked_runs AS (
  SELECT lr.id,
         lr.run_guid,
         lr.region,
         lr.season_id,
         lr.period_id,
         lr.dungeon_id,
         lr.realm_id,
         lr.completed_at,
         lr.duration_ms,
         lr.keystone_level,
         lr.score,
         lr.rank,
         row_number() OVER (PARTITION BY lr.season_id ORDER BY lr.keystone_level DESC, lr.score DESC) AS rn
  FROM public.leaderboard_run lr
)
SELECT id,
       run_guid,
       region,
       season_id,
       period_id,
       dungeon_id,
       realm_id,
       completed_at,
       duration_ms,
       keystone_level,
       score,
       rank,
       rn,
       (SELECT json_agg(json_build_object('character_name', rgm.character_name, 'class_id', rgm.class_id, 'spec_id', rgm.spec_id, 'role', rgm.role) ORDER BY rgm.character_name) AS json_agg
        FROM public.run_group_member rgm
        WHERE (rgm.run_guid = r.run_guid)) AS members
FROM ranked_runs r
WHERE (rn <= 1000);

-- Materialized view for top keys per (season_id, period_id)
CREATE MATERIALIZED VIEW public.top_keys_per_period AS
WITH ranked_runs AS (
  SELECT lr.id,
         lr.run_guid,
         lr.region,
         lr.season_id,
         lr.period_id,
         lr.dungeon_id,
         lr.realm_id,
         lr.completed_at,
         lr.duration_ms,
         lr.keystone_level,
         lr.score,
         lr.rank,
         row_number() OVER (PARTITION BY lr.season_id, lr.period_id ORDER BY lr.keystone_level DESC, lr.score DESC) AS rn
  FROM public.leaderboard_run lr
)
SELECT id,
       run_guid,
       region,
       season_id,
       period_id,
       dungeon_id,
       realm_id,
       completed_at,
       duration_ms,
       keystone_level,
       score,
       rank,
       rn,
       (SELECT json_agg(json_build_object('character_name', rgm.character_name, 'class_id', rgm.class_id, 'spec_id', rgm.spec_id, 'role', rgm.role) ORDER BY rgm.character_name) AS json_agg
        FROM public.run_group_member rgm
        WHERE (rgm.run_guid = r.run_guid)) AS members
FROM ranked_runs r
WHERE (rn <= 1000);

-- Materialized view for top keys per (season_id, dungeon_id)
CREATE MATERIALIZED VIEW public.top_keys_per_dungeon AS
WITH ranked_runs AS (
  SELECT lr.id,
         lr.run_guid,
         lr.region,
         lr.season_id,
         lr.period_id,
         lr.dungeon_id,
         lr.realm_id,
         lr.completed_at,
         lr.duration_ms,
         lr.keystone_level,
         lr.score,
         lr.rank,
         row_number() OVER (PARTITION BY lr.season_id, lr.dungeon_id ORDER BY lr.keystone_level DESC, lr.score DESC) AS rn
  FROM public.leaderboard_run lr
)
SELECT id,
       run_guid,
       region,
       season_id,
       period_id,
       dungeon_id,
       realm_id,
       completed_at,
       duration_ms,
       keystone_level,
       score,
       rank,
       rn,
       (SELECT json_agg(json_build_object('character_name', rgm.character_name, 'class_id', rgm.class_id, 'spec_id', rgm.spec_id, 'role', rgm.role) ORDER BY rgm.character_name) AS json_agg
        FROM public.run_group_member rgm
        WHERE (rgm.run_guid = r.run_guid)) AS members
FROM ranked_runs r
WHERE (rn <= 1000);

-- Indexes for materialized views (required for CONCURRENTLY refresh)
CREATE INDEX idx_top_keys_per_group_lookup ON public.top_keys_per_group USING btree (season_id, period_id, dungeon_id, keystone_level DESC, score DESC) INCLUDE (id, run_guid, completed_at);
CREATE INDEX idx_top_keys_per_group_time ON public.top_keys_per_group USING btree (completed_at DESC) INCLUDE (season_id, period_id, dungeon_id, keystone_level, score);
CREATE UNIQUE INDEX idx_top_keys_per_group_unique_id ON public.top_keys_per_group USING btree (id);

CREATE INDEX idx_top_keys_global_lookup ON public.top_keys_global USING btree (season_id, keystone_level DESC, score DESC) INCLUDE (id, run_guid, completed_at);
CREATE UNIQUE INDEX idx_top_keys_global_unique_id ON public.top_keys_global USING btree (id);

CREATE INDEX idx_top_keys_per_period_lookup ON public.top_keys_per_period USING btree (season_id, period_id, keystone_level DESC, score DESC) INCLUDE (id, run_guid, completed_at);
CREATE INDEX idx_top_keys_per_period_time ON public.top_keys_per_period USING btree (completed_at DESC) INCLUDE (season_id, period_id, keystone_level, score);
CREATE UNIQUE INDEX idx_top_keys_per_period_unique_id ON public.top_keys_per_period USING btree (id);

CREATE INDEX idx_top_keys_per_dungeon_lookup ON public.top_keys_per_dungeon USING btree (season_id, dungeon_id, keystone_level DESC, score DESC) INCLUDE (id, run_guid, completed_at);
CREATE UNIQUE INDEX idx_top_keys_per_dungeon_unique_id ON public.top_keys_per_dungeon USING btree (id);

-- Staging table for bulk import of run_group_member
CREATE TABLE IF NOT EXISTS public.run_group_member_staging (
    run_guid uuid,
    character_name character varying(64),
    class_id integer,
    spec_id integer,
    role character varying(16)
);

-- NOTE: After importing data, refresh materialized views with:
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_group;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_global;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_period;
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_dungeon;
