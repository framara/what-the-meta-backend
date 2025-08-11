## PostgreSQL Partitioning Plan (leaderboard_run, run_group_member)

This document describes a low‑maintenance strategy to partition the two largest tables by `season_id`, with near‑zero touch between seasons and fast archival/cleanup when needed.

### Goals
- Improve query and maintenance performance by enabling partition pruning on `season_id`.
- Make seasonal cleanup/archival O(1) via `DROP PARTITION`.
- Require minimal ongoing maintenance as new seasons start.

### Current state (summary)
- `leaderboard_run(id, run_guid, region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank)` with unique constraints and multiple composite indexes.
- `run_group_member(run_guid, character_name, class_id, spec_id, role)` with PK `(run_guid, character_name)` referencing `leaderboard_run(run_guid)`.

### Strategy (LIST partitioning on season_id)
- Convert both tables to partitioned parents `PARTITION BY LIST (season_id)`.
- Add a `DEFAULT` partition so new seasons “just work” without manual DDL.
- Optionally create a dedicated partition per season (Sxx) when convenient; a helper function can auto‑create partitions for the latest season.

Partitioning requires that all columns of the partition key be part of the PRIMARY KEY/UNIQUE constraints. For `run_group_member`, we add `season_id` to the table and to the PK.

---

## Migration Plan (one‑time)

Run on a maintenance window. Refresh materialized views at the end.

1) Create partitioned parents and a `DEFAULT` partition

```sql
-- 1. New partitioned parent for leaderboard_run
CREATE TABLE leaderboard_run_p (
  id              BIGSERIAL PRIMARY KEY,
  run_guid        UUID UNIQUE,
  region          VARCHAR(8),
  season_id       INTEGER NOT NULL,
  period_id       INTEGER,
  dungeon_id      INTEGER,
  realm_id        INTEGER,
  completed_at    TIMESTAMP,
  duration_ms     INTEGER,
  keystone_level  INTEGER,
  score           DOUBLE PRECISION,
  rank            INTEGER,
  UNIQUE (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level, score)
) PARTITION BY LIST (season_id);

ALTER TABLE leaderboard_run_p
  ADD CONSTRAINT lr_p_dungeon_fk FOREIGN KEY (dungeon_id) REFERENCES dungeon(id),
  ADD CONSTRAINT lr_p_period_fk  FOREIGN KEY (period_id)  REFERENCES period(id),
  ADD CONSTRAINT lr_p_realm_fk   FOREIGN KEY (realm_id)   REFERENCES realm(id),
  ADD CONSTRAINT lr_p_season_fk  FOREIGN KEY (season_id)  REFERENCES season(id);

CREATE INDEX idx_lr_p_cleanup                   ON leaderboard_run_p (season_id, period_id, dungeon_id, keystone_level DESC, score DESC) INCLUDE (id);
CREATE INDEX idx_lr_p_season_dungeon            ON leaderboard_run_p (season_id, dungeon_id, keystone_level DESC, score);
CREATE INDEX idx_lr_p_season_period_dungeon     ON leaderboard_run_p (season_id, period_id, dungeon_id, keystone_level DESC, score DESC);

-- Default partition catches new seasons automatically
CREATE TABLE leaderboard_run_default PARTITION OF leaderboard_run_p DEFAULT;

-- 2. Add season_id to run_group_member and backfill from leaderboard_run
ALTER TABLE run_group_member ADD COLUMN season_id INTEGER;
UPDATE run_group_member rgm
SET season_id = lr.season_id
FROM leaderboard_run lr
WHERE lr.run_guid = rgm.run_guid
  AND rgm.season_id IS NULL;
ALTER TABLE run_group_member ALTER COLUMN season_id SET NOT NULL;

-- 3. New partitioned parent for run_group_member
CREATE TABLE run_group_member_p (
  season_id      INTEGER NOT NULL,
  run_guid       UUID    NOT NULL,
  character_name VARCHAR(64) NOT NULL,
  class_id       INTEGER,
  spec_id        INTEGER,
  role           VARCHAR(16),
  PRIMARY KEY (season_id, run_guid, character_name),
  FOREIGN KEY (run_guid) REFERENCES leaderboard_run_p(run_guid) ON DELETE CASCADE
) PARTITION BY LIST (season_id);

CREATE TABLE run_group_member_default PARTITION OF run_group_member_p DEFAULT;
```

2) Copy data and swap names (atomic rename)

```sql
-- Route rows through parents so they land in the correct partitions
INSERT INTO leaderboard_run_p
SELECT * FROM leaderboard_run;

INSERT INTO run_group_member_p (season_id, run_guid, character_name, class_id, spec_id, role)
SELECT season_id, run_guid, character_name, class_id, spec_id, role
FROM run_group_member;

-- Swap names
ALTER TABLE run_group_member  RENAME TO run_group_member_old;
ALTER TABLE leaderboard_run   RENAME TO leaderboard_run_old;
ALTER TABLE leaderboard_run_p RENAME TO leaderboard_run;
ALTER TABLE run_group_member_p RENAME TO run_group_member;

-- (optional) Drop old after verification
-- DROP TABLE run_group_member_old;
-- DROP TABLE leaderboard_run_old;
```

3) Refresh materialized views (if present)

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_group;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_global;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_period;
REFRESH MATERIALIZED VIEW CONCURRENTLY top_keys_per_dungeon;
```

---

## Optional: Dedicated per‑season partitions

You can run the system forever with only the `DEFAULT` partitions. If you want easy archival or drop, create per‑season partitions at your convenience:

```sql
-- Example for season 14
CREATE TABLE leaderboard_run_s14    PARTITION OF leaderboard_run     FOR VALUES IN (14);
CREATE TABLE run_group_member_s14   PARTITION OF run_group_member    FOR VALUES IN (14);

-- Move rows out of DEFAULT (optional, do in batches if very large)
INSERT INTO leaderboard_run
SELECT * FROM leaderboard_run WHERE season_id = 14 AND tableoid = 'leaderboard_run_default'::regclass;
DELETE FROM ONLY leaderboard_run_default WHERE season_id = 14;

INSERT INTO run_group_member
SELECT * FROM run_group_member WHERE season_id = 14 AND tableoid = 'run_group_member_default'::regclass;
DELETE FROM ONLY run_group_member_default WHERE season_id = 14;
```

### Fast cleanup
To purge an old season:

```sql
DROP TABLE IF EXISTS run_group_member_s13;
DROP TABLE IF EXISTS leaderboard_run_s13;
```

---

## Zero/Near‑Zero Maintenance Between Seasons

- The `DEFAULT` partitions ensure new seasons work without DDL.
- If you like dedicated partitions, use the helper function below and call it daily/weekly or on app startup.

```sql
CREATE OR REPLACE FUNCTION ensure_partitions_for_latest_season() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  s INTEGER;
  part_lr TEXT;
  part_rgm TEXT;
BEGIN
  SELECT MAX(id) INTO s FROM season;
  IF s IS NULL THEN RETURN; END IF;

  part_lr  := format('leaderboard_run_s%s', s);
  part_rgm := format('run_group_member_s%s', s);

  PERFORM 1 FROM pg_class WHERE relname = part_lr;
  IF NOT FOUND THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF leaderboard_run FOR VALUES IN (%s);', part_lr, s);
  END IF;

  PERFORM 1 FROM pg_class WHERE relname = part_rgm;
  IF NOT FOUND THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF run_group_member FOR VALUES IN (%s);', part_rgm, s);
  END IF;
END $$;
```

Call from your daily automation (or manually) to ensure the latest season has dedicated partitions; otherwise, `DEFAULT` continues to handle inserts.

---

## Application Impact

- No code changes required for reads/writes if you keep the same table names and insert via the parent tables.
- Ensure all hot queries continue to filter by `season_id` so the planner prunes partitions.
- For `run_group_member`, PK becomes `(season_id, run_guid, character_name)`. Joins by `run_guid` remain valid; the FK references `leaderboard_run(run_guid)`.

---

## Rollback Plan

1) Create non‑partitioned clones (same schema as before) and copy data back.
2) Swap names back (`*_old` → live) and drop partitioned parents.
3) Refresh materialized views.

---

## Validation Checklist

- [ ] `SELECT COUNT(*)` matches before/after migration for both tables
- [ ] Random sample rows per season match across old/new
- [ ] Top keys materialized views refresh successfully
- [ ] Hot endpoints latency unchanged or improved

---

## FAQ

**Q: Do we have to precreate a partition for every new season?**
A: No. The `DEFAULT` partition captures new seasons automatically. Dedicated partitions are optional and can be created later.

**Q: Will existing indexes be used?**
A: Create indexes on the partitioned parent (as above); Postgres propagates them to future partitions. For existing partitions, create indexes individually if needed.

**Q: Any impact on foreign keys?**
A: `run_group_member` now includes `season_id` in the PK; it still references `leaderboard_run(run_guid)`. This is supported.


