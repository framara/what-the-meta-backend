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

**New:**
- These endpoints now return a detailed status object:
  - `status`: "OK" if all files were written, "PARTIAL" if any failed
  - `filesWritten`: Number of files successfully written
  - `filesExpected`: Total number of files expected
  - `failedCount`: Number of failed tasks
  - `failedReasons`: Array of error messages for failed tasks
- This allows you to detect and debug partial or failed exports easily.

### Admin Import
- `POST /admin/import-leaderboard-json` — Import a single JSON file from `./output` into the database
  - Body: `{ "filename": "eu-s14-p1001-d247.json" }`
- `POST /admin/import-all-leaderboard-json` — Import all JSON files in `./output` into the database (parallelized, batched)
- `POST /admin/import-leaderboard-copy` — **Recommended for large imports**: Bulk import using CSV and PostgreSQL COPY, with staging table and upsert for deduplication and speed.

---

## Database Schema

- **dungeon**: `(id, name)`
- **period**: `(id, season_id, start_date, end_date)`
- **realm**: `(id, name, region)`
- **season**: `(id, name, start_date, end_date)`
- **leaderboard_run**: `(id, region, season_id, period_id, dungeon_id, realm_id, completed_at, duration_ms, keystone_level, score, rank, run_guid)`
  - Unique constraint on all identifying columns
- **run_group_member**: `(run_guid, character_name, class_id, spec_id, role)`
  - Primary key: `(run_guid, character_name)`
- **run_group_member_staging**: Staging table for bulk import (no constraints)

**Indexes**: Optimized for leaderboard queries and group member lookups (see `db_structure.sql`).

---

## Import Workflow

1. Use the advanced endpoints to generate JSON files in `./output`:
   - `/wow/advanced/mythic-leaderboard/:seasonId/`
   - `/wow/advanced/mythic-leaderboard/:seasonId/:periodId`
   - **Check the response for status and failed files.**
2. Import data into the database:
   - `POST /admin/import-leaderboard-json` (single file)
   - `POST /admin/import-all-leaderboard-json` (all files, parallelized)
   - `POST /admin/import-leaderboard-copy` (**recommended for large data**)

**Performance & Robustness:**
- Imports use batch inserts (500 rows per batch) for group members.
- `/import-all-leaderboard-json` processes up to 4 files in parallel for speed.
- `/import-leaderboard-copy` uses CSV, PostgreSQL COPY, and a staging table with upsert logic for deduplication and high performance. This avoids duplicate key errors and ensures atomic, robust imports.
- Each file import is wrapped in a transaction for atomicity and speed.
- Progress bars and detailed error reporting are provided for all bulk operations.

---

## Optimized PostgreSQL Setup

### Requirements
- Docker Desktop with at least:
  - 8GB RAM allocated
  - 4 CPU cores
  - 50GB disk space

### Quick Start
1. Build and start the container:
```bash
docker-compose up -d
```

2. Check container health:
```bash
docker-compose ps
docker logs wow-postgres
```

3. Monitor performance:
```bash
# Check container stats
docker stats wow-postgres

# Check PostgreSQL stats
curl http://localhost:3000/admin/db/stats
```

### Configuration
- PostgreSQL configuration is in `postgresql.conf`
- Container resources are defined in `docker-compose.yml`
- Database initialization is handled by `Dockerfile.postgres`

### Data Migration
If you need to migrate data from the old container:

1. Stop the old container:
```bash
docker stop wow-postgres-old
```

2. Backup your data:
```bash
docker exec wow-postgres-old pg_dumpall -U wowuser > backup.sql
```

3. Start the new container:
```bash
docker-compose up -d
```

4. Restore the data:
```bash
cat backup.sql | docker exec -i wow-postgres psql -U wowuser
```

### Maintenance
Regular maintenance tasks:

1. Vacuum analyze (weekly):
```bash
curl -X POST http://localhost:3000/admin/db/analyze
```

2. Check slow queries:
```bash
curl http://localhost:3000/admin/db/stats | jq '.slow_queries'
```

3. Monitor table sizes:
```bash
curl http://localhost:3000/admin/db/stats | jq '.table_sizes'
```

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
- The DB schema is a clean slate: run `db_structure.sql` to reset and create all tables/indexes (including the staging table for bulk import).
- All group composition is tracked per run in `run_group_member` (no more group_member or leaderboard_group tables).
- For more details, see comments in `db_structure.sql` and the code in `src/routes/admin.js` and `src/routes/wow.js`.
- If you encounter partial exports or imports, check the returned `failedReasons` for troubleshooting. 