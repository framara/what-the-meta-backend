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
    UNIQUE (dungeon_id, period_id, realm_id, season_id, region, completed_at, duration_ms, keystone_level)
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

-- End of clean slate schema

