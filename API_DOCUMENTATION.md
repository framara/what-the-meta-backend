# WoW API Proxy & Leaderboard - API Documentation

## Overview

This API proxy provides a unified interface for Blizzard's World of Warcraft Game Data API, advanced leaderboard aggregation, and a robust import/ETL pipeline for meta analysis. It abstracts OAuth, regional routing, and data aggregation for both consumers and admin users.

## Base URL
```
http://localhost:3000
```

## Regional Support
All endpoints support the following regions via the `region` query parameter:
- `us` - Americas (default)
- `eu` - Europe
- `kr` - Korea
- `tw` - Taiwan

## Authentication
- The proxy handles Blizzard OAuth automatically. No authentication is required from API consumers for public endpoints.

---

## Endpoints

### Health Check
#### GET /health
Returns the overall health status of the API proxy.

---

### Game Data Endpoints
All Blizzard WoW Game Data endpoints are proxied as-is. Example:

#### GET /wow/game-data/achievements?region=us
#### GET /wow/game-data/classes?region=eu
#### GET /wow/game-data/items/:id?region=kr

- See Blizzard's official documentation for full endpoint list and parameters.
- All responses are forwarded as-is from Blizzard.

---

### Advanced Aggregation Endpoints

#### GET /wow/advanced/mythic-leaderboard/index
Returns all mythic leaderboard indexes for all connected realms.

**Example Request:**
/wow/advanced/mythic-leaderboard/index?region=us

**Response:**
```
{
  "connectedRealmCount": 10,
  "results": [ ... ]
}
```

#### GET /wow/advanced/mythic-leaderboard/:dungeonId/period/:period
Returns leaderboard data for a specific dungeon and period across all connected realms.

**Example Request:**
/wow/advanced/mythic-leaderboard/504/period/1018?region=us

**Response:**
```
{
  "connectedRealmCount": 10,
  "results": [ ... ]
}
```

#### GET /wow/advanced/mythic-keystone-season/:seasonId/dungeons
Returns all dungeon IDs for a given season.

**Example Request:**
/wow/advanced/mythic-keystone-season/14/dungeons?region=us

**Response:**
```
{
  "seasonId": 14,
  "dungeons": [504, 505, ...],
  "cached": true
}
```

#### GET /wow/advanced/mythic-keystone-season/:seasonId/name
Returns the name of a given season.

**Example Request:**
/wow/advanced/mythic-keystone-season/14/name

**Response:**
```
{
  "seasonId": 14,
  "name": "Dragonflight Season 4"
}
```

#### GET /wow/advanced/mythic-leaderboard/:seasonId/
Aggregates and writes leaderboard data for all dungeons and periods in a season. Writes results to JSON files in `./output`.

**Example Request:**
/wow/advanced/mythic-leaderboard/14/

#### GET /wow/advanced/mythic-leaderboard/:seasonId/:periodId
Aggregates and writes leaderboard data for all dungeons in a season and period. Writes results to JSON files in `./output`.

**Example Request:**
/wow/advanced/mythic-leaderboard/14/1018

---

### Filter Population Endpoints

#### GET /wow/advanced/seasons
Returns all available season IDs and names.

**Example Request:**
/wow/advanced/seasons

**Response:**
```
[
  { "season_id": 14, "season_name": "Dragonflight Season 4" },
  ...
]
```

#### GET /wow/advanced/season-info/:seasonId
Returns all periods (with names) and dungeons (with names) for a given season.

**Example Request:**
/wow/advanced/season-info/14

**Response:**
```
{
  "periods": [
    { "period_id": 1001, "period_name": "Week 1" },
    { "period_id": 1002, "period_name": "Week 2" },
    ...
  ],
  "dungeons": [
    { "dungeon_id": 504, "dungeon_name": "Dawn of the Infinite: Galakrond's Fall" },
    ...
  ]
}
```

---

### Meta/Consumer Endpoints

#### GET /meta/top-keys
Returns top N leaderboard runs, with group composition, for meta analysis.

**Query Parameters:**
- `season_id` (required): Season to query
- `period_id` (optional): Filter by period
- `dungeon_id` (optional): Filter by dungeon
- `limit` (optional, default 100, max 500): Number of results per request
- `offset` (optional, default 0): For pagination

**Behavior:**
- If only `season_id` is provided: returns top N globally for the season
- If `season_id` and `period_id` are provided: returns top N for that season/period
- If `dungeon_id` is provided: returns top N for that group (season/period/dungeon)
- **If `season_id` and `dungeon_id` are provided (but not `period_id`): returns top N for that dungeon across all periods in the season**

**Example Requests:**
- `/meta/top-keys?season_id=14` (top N globally for season 14)
- `/meta/top-keys?season_id=14&period_id=1001` (top N for period 1001, season 14)
- `/meta/top-keys?season_id=14&period_id=1001&dungeon_id=247` (top N for dungeon 247, period 1001, season 14)
- `/meta/top-keys?season_id=14&dungeon_id=247` (top N for dungeon 247, all periods, season 14)
- `/meta/top-keys?season_id=14&limit=50&offset=100` (pagination)

**Example Response:**
```json
[
  {
    "id": 12345,
    "season_id": 14,
    "period_id": 1001,
    "dungeon_id": 247,
    "realm_id": 509,
    "region": "eu",
    "completed_at": "2024-05-01T12:34:56.000Z",
    "duration_ms": 1234567,
    "keystone_level": 22,
    "score": 312.5,
    "rank": 1,
    "members": [
      { "character_name": "Playerone", "class_id": 1, "spec_id": 71, "role": "dps" },
      ...
    ]
  },
  ...
]
```

---

### Admin/Import Endpoints

#### POST /admin/import-leaderboard-json
Import a single JSON file from `./output` into the database.
- **Body:** `{ "filename": "eu-s14-p1001-d247.json" }`
- **Returns:** Import summary

#### POST /admin/import-all-leaderboard-json
Import all JSON files in `./output` into the database (batched, parallelized, progress bar in logs).
- **Returns:** Import summary

#### POST /admin/clear-output
Deletes all files in the `./output` directory. **Not allowed in production.**
- **Returns:** List of deleted files and any errors.
- **Example Response:**
```json
{
  "status": "OK",
  "deleted": ["file1.json", "file2.json"],
  "errors": []
}
```

#### POST /admin/refresh-views
Refreshes all materialized views used for meta/leaderboard queries.
- **Purpose:** Ensures the latest imported data is reflected in all meta/leaderboard endpoints.
- **Returns:** Status and message.
- **Example Response:**
```json
{
  "status": "OK",
  "message": "All materialized views refreshed."
}
```

---

## Import/ETL Workflow

1. Use advanced endpoints to generate JSON files in `./output`:
   - `/wow/advanced/mythic-leaderboard/:seasonId/`
   - `/wow/advanced/mythic-leaderboard/:seasonId/:periodId`
2. Import data into the database:
   - `POST /admin/import-leaderboard-json` (single file)
   - `POST /admin/import-all-leaderboard-json` (all files, batched)
3. After import, run:
   ```sql
   REFRESH MATERIALIZED VIEW top_keys_per_group;
   REFRESH MATERIALIZED VIEW top_keys_global;
   REFRESH MATERIALIZED VIEW top_keys_per_period;
   REFRESH MATERIALIZED VIEW top_keys_per_dungeon;
   ```

---

## Database Structure

- See `db/db_structure.sql` for full schema.
- Main tables: `leaderboard_run`, `run_group_member`, `dungeon`, `period`, `realm`, `season`
- Materialized views: `top_keys_per_group`, `top_keys_global`, `top_keys_per_period`, `top_keys_per_dungeon`
- Indexes for fast filtering and sorting

---

## Error Handling

- Standard HTTP status codes (`200`, `400`, `404`, `500`, etc.)
- Error responses:
```json
{
  "error": true,
  "message": "Error description",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/meta/top-keys",
  "method": "GET"
}
```

---

## Rate Limiting
- 100 requests per 15 minutes per IP
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

## Security
- Helmet.js for security headers
- CORS enabled
- Input validation for all parameters

---

## Environment Variables

Set these in your `.env` file:
```
BLIZZARD_CLIENT_ID=your_client_id_here
BLIZZARD_CLIENT_SECRET=your_client_secret_here
PORT=3000
NODE_ENV=development
PGHOST=localhost
PGPORT=5432
PGUSER=wowuser
PGPASSWORD=yourpassword
PGDATABASE=wow_leaderboard
```

---

## Support
For issues or questions, check the project README or create an issue in the repository. 