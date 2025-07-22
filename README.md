# WoW API Proxy & Leaderboard Importer

## Overview

This project provides a proxy for the Blizzard World of Warcraft Game Data API, advanced aggregation endpoints for Mythic+ leaderboards, and a robust import pipeline for storing leaderboard data in a PostgreSQL database.

---

## API Endpoints

### Game Data
- `GET /wow/game-data/*` — Proxies all Blizzard WoW Game Data endpoints (achievements, dungeons, classes, realms, etc.)

### Advanced Aggregation
- `GET /wow/advanced/mythic-leaderboard/:seasonId/` — Aggregates all runs for all dungeons, periods, and realms for a season, writes to JSON files
- `GET /wow/advanced/mythic-leaderboard/:seasonId/:periodId` — Aggregates all runs for all dungeons and realms for a specific period, writes to JSON files

### Admin Import
- `POST /admin/import-leaderboard-json` — Import a single JSON file from `./output` into the database
  - Body: `{ "filename": "eu-s14-p1001-d247.json" }`
- `POST /admin/import-all-leaderboard-json` — Import all JSON files in `./output` into the database (parallelized, batched)

---

## Database Schema

- **dungeon**: `(id, name)`
- **period**: `(id, season_id, start_date, end_date)`
- **realm**: `(id, name, region)`
- **season**: `(id, name, start_date, end_date)`
- **leaderboard_run**: `(id, region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank)`
  - Unique constraint on all identifying columns
- **run_group_member**: `(run_id, character_name, class_id, spec_id, role)`
  - Primary key: `(run_id, character_name)`

**Indexes**: Optimized for leaderboard queries and group member lookups (see `db_structure.sql`).

---

## Import Workflow

1. Use the advanced endpoints to generate JSON files in `./output`:
   - `/wow/advanced/mythic-leaderboard/:seasonId/`
   - `/wow/advanced/mythic-leaderboard/:seasonId/:periodId`
2. Import data into the database:
   - `POST /admin/import-leaderboard-json` (single file)
   - `POST /admin/import-all-leaderboard-json` (all files, parallelized)

**Performance:**
- Imports use batch inserts (500 rows per batch) for group members.
- `/import-all-leaderboard-json` processes up to 4 files in parallel for speed.
- Each file import is wrapped in a transaction for atomicity and speed.

---

## Environment Variables

Set these in your `.env` file:
```
PGHOST=localhost
PGPORT=5432
PGUSER=wowuser
PGPASSWORD=yourpassword
PGDATABASE=wow_leaderboard
```

---

## Notes
- The DB schema is a clean slate: run `db_structure.sql` to reset and create all tables/indexes.
- All group composition is tracked per run in `run_group_member` (no more group_member or leaderboard_group tables).
- For more details, see comments in `db_structure.sql` and the code in `src/routes/admin.js`. 