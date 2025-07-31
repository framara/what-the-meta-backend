# WoW API Proxy & Leaderboard - API Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Regional Support](#regional-support)
4. [Health & Status Endpoints](#health--status-endpoints)
5. [Game Data Endpoints](#game-data-endpoints)
6. [Advanced Aggregation Endpoints](#advanced-aggregation-endpoints)
7. [Filter Population Endpoints](#filter-population-endpoints)
8. [Meta/Consumer Endpoints](#metaconsumer-endpoints)
9. [Admin Endpoints](#admin-endpoints)
10. [Database Management Endpoints](#database-management-endpoints)
11. [Automation Endpoints](#automation-endpoints)
12. [Error Handling](#error-handling)
13. [Rate Limiting](#rate-limiting)
14. [Environment Variables](#environment-variables)

---

## 🎯 Overview

This API proxy provides a unified interface for Blizzard's World of Warcraft Game Data API, advanced leaderboard aggregation, and a robust import/ETL pipeline for meta analysis. It abstracts OAuth, regional routing, and data aggregation for both consumers and admin users.

### Key Features
- **Blizzard API Proxy**: Direct access to all WoW Game Data endpoints
- **Advanced Aggregation**: Multi-region leaderboard data collection
- **Database Integration**: PostgreSQL with optimized materialized views
- **Admin Tools**: Import, cleanup, and maintenance operations
- **Automation**: Scheduled data collection and processing

---

## 🔐 Authentication

### Public Endpoints
- No authentication required for public endpoints
- The proxy handles Blizzard OAuth automatically

### Admin Endpoints
- Require admin authentication via `adminAuthMiddleware`
- Protected by environment-based authentication

---

## 🌍 Regional Support

All endpoints support the following regions via the `region` query parameter:
- `us` - Americas (default)
- `eu` - Europe  
- `kr` - Korea
- `tw` - Taiwan

---

## 🏥 Health & Status Endpoints

### GET /health
Returns the overall health status of the API proxy.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 3600
}
```

---

## 🎮 Game Data Endpoints

All Blizzard WoW Game Data endpoints are proxied as-is. These provide direct access to Blizzard's official API.

### Examples:
- `GET /wow/game-data/achievements?region=us`
- `GET /wow/game-data/classes?region=eu`
- `GET /wow/game-data/items/:id?region=kr`
- `GET /wow/game-data/specializations?region=tw`

**Response:** Forwarded as-is from Blizzard's API

---

## 🔄 Advanced Aggregation Endpoints

### GET /wow/advanced/mythic-leaderboard/index
Returns all mythic leaderboard indexes for all connected realms.

**Query Parameters:**
- `region` (optional): Region code (us, eu, kr, tw)

**Example Request:**
```
GET /wow/advanced/mythic-leaderboard/index?region=us
```

**Response:**
```json
{
  "connectedRealmCount": 10,
  "results": [
    {
      "href": "/data/wow/connected-realm/1/mythic-leaderboard/index",
      "key": {
        "href": "/data/wow/connected-realm/1"
      }
    }
  ]
}
```

### GET /wow/advanced/mythic-leaderboard/:dungeonId/period/:period
Returns leaderboard data for a specific dungeon and period across all connected realms.

**Path Parameters:**
- `dungeonId`: Dungeon ID
- `period`: Period ID

**Query Parameters:**
- `region` (optional): Region code

**Example Request:**
```
GET /wow/advanced/mythic-leaderboard/504/period/1018?region=us
```

**Response:**
```json
{
  "connectedRealmCount": 10,
  "results": [
    {
      "href": "/data/wow/connected-realm/1/mythic-leaderboard/504/period/1018",
      "key": {
        "href": "/data/wow/connected-realm/1"
      },
      "name": "Connected Realm 1"
    }
  ]
}
```

### GET /wow/advanced/mythic-keystone-season/:seasonId/dungeons
Returns all dungeon IDs for a given season.

**Path Parameters:**
- `seasonId`: Season ID

**Query Parameters:**
- `region` (optional): Region code

**Example Request:**
```
GET /wow/advanced/mythic-keystone-season/14/dungeons?region=us
```

**Response:**
```json
{
  "seasonId": 14,
  "dungeons": [504, 505, 506, 507],
  "cached": true
}
```

### GET /wow/advanced/mythic-keystone-season/:seasonId/name
Returns the name of a given season.

**Path Parameters:**
- `seasonId`: Season ID

**Example Request:**
```
GET /wow/advanced/mythic-keystone-season/14/name
```

**Response:**
```json
{
  "seasonId": 14,
  "name": "Dragonflight Season 4"
}
```

### GET /wow/advanced/mythic-leaderboard/:seasonId/
Aggregates and writes leaderboard data for all dungeons and periods in a season. Writes results to JSON files in `./output`.

**Path Parameters:**
- `seasonId`: Season ID

**Query Parameters:**
- `region` (optional): Region code. If not specified, processes all 4 regions (us, eu, kr, tw)
- `fromPeriod` (optional): Starting period ID to filter from (inclusive)
- `toPeriod` (optional): Ending period ID to filter to (inclusive)

**Example Request:**
```
GET /wow/advanced/mythic-leaderboard/14/
GET /wow/advanced/mythic-leaderboard/14/?region=us
GET /wow/advanced/mythic-leaderboard/14/?fromPeriod=1018&toPeriod=1020
GET /wow/advanced/mythic-leaderboard/14/?region=us&fromPeriod=1018
```

**Response:**
```json
{
  "status": "OK",
  "message": "Data written to JSON files",
  "filesWritten": 120,
  "filesExpected": 120,
  "failedCount": 0,
  "failedReasons": [],
  "regionsProcessed": ["us", "eu", "kr", "tw"],
  "regionsCount": 4,
  "periodFilter": {
    "fromPeriod": 1018,
    "toPeriod": 1020,
    "applied": true
  }
}
```

### GET /wow/advanced/mythic-leaderboard/:seasonId/:periodId
Aggregates and writes leaderboard data for all dungeons in a season and period. Writes results to JSON files in `./output`.

**Path Parameters:**
- `seasonId`: Season ID
- `periodId`: Period ID

**Query Parameters:**
- `region` (optional): Region code. If not specified, processes all 4 regions

**Example Request:**
```
GET /wow/advanced/mythic-leaderboard/14/1018
GET /wow/advanced/mythic-leaderboard/14/1018?region=us
```

**Response:**
```json
{
  "status": "OK",
  "message": "Data written to JSON files",
  "filesWritten": 30,
  "filesExpected": 30,
  "failedCount": 0,
  "failedReasons": [],
  "regionsProcessed": ["us", "eu", "kr", "tw"],
  "regionsCount": 4
}
```

---

## 🎛️ Filter Population Endpoints

### GET /wow/advanced/seasons
Returns all available season IDs and names.

**Example Request:**
```
GET /wow/advanced/seasons
```

**Response:**
```json
[
  { "season_id": 14, "season_name": "Dragonflight Season 4" },
  { "season_id": 13, "season_name": "Dragonflight Season 3" },
  { "season_id": 12, "season_name": "Dragonflight Season 2" }
]
```

### GET /wow/advanced/season-info/:seasonId
Returns all periods (with names) and dungeons (with names) for a given season.

**Path Parameters:**
- `seasonId`: Season ID

**Query Parameters:**
- `region` (optional): Region code

**Example Request:**
```
GET /wow/advanced/season-info/14
```

**Response:**
```json
{
  "periods": [
    { "period_id": 1001, "period_name": "Week 1" },
    { "period_id": 1002, "period_name": "Week 2" },
    { "period_id": 1003, "period_name": "Week 3" }
  ],
  "dungeons": [
    { "dungeon_id": 504, "dungeon_name": "Dawn of the Infinite: Galakrond's Fall", "dungeon_shortname": "FALL" },
    { "dungeon_id": 505, "dungeon_name": "Dawn of the Infinite: Murozond's Rise", "dungeon_shortname": "RISE" }
  ]
}
```

---

## 📊 Meta/Consumer Endpoints

### GET /meta/top-keys
Returns top N leaderboard runs, with group composition, for meta analysis.

**Query Parameters:**
- `season_id` (required): Season to query
- `period_id` (optional): Filter by period
- `dungeon_id` (optional): Filter by dungeon
- `limit` (optional, default 100, max 1000): Number of results per request
- `offset` (optional, default 0): For pagination

**Behavior:**
- If only `season_id` is provided: returns top N globally for the season (uses `top_keys_global` view)
- If `season_id` and `period_id` are provided (no dungeon_id): returns top N for that season/period (uses `top_keys_per_period` view)
- If `season_id` and `dungeon_id` are provided (no period_id): returns top N for that dungeon across all periods (uses `top_keys_per_dungeon` view)
- If all three parameters are provided: returns top N for that specific group (uses `top_keys_per_group` view)

**Example Requests:**
```
GET /meta/top-keys?season_id=14
GET /meta/top-keys?season_id=14&period_id=1001
GET /meta/top-keys?season_id=14&period_id=1001&dungeon_id=247
GET /meta/top-keys?season_id=14&dungeon_id=247
GET /meta/top-keys?season_id=14&limit=50&offset=100
```

**Response:**
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
    "rn": 1,
    "members": [
      { "character_name": "Playerone", "class_id": 1, "spec_id": 71, "role": "dps" },
      { "character_name": "Playertwo", "class_id": 2, "spec_id": 65, "role": "tank" },
      { "character_name": "Playerthree", "class_id": 5, "spec_id": 258, "role": "healer" }
    ]
  }
]
```

### GET /meta/season-data/:season_id
Retrieves top 1000 keys for each period in a given season. Returns comprehensive data over time for AI analysis.

**Path Parameters:**
- `season_id`: Season ID (required)

**Example Request:**
```
GET /meta/season-data/14
```

**Response:**
```json
{
  "season_id": 14,
  "total_periods": 12,
  "total_keys": 12000,
  "periods": [
    {
      "period_id": 1001,
      "keys_count": 1000,
      "keys": [
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
          "rn": 1,
          "members": [
            { "character_name": "Playerone", "class_id": 1, "spec_id": 71, "role": "dps" },
            { "character_name": "Playertwo", "class_id": 2, "spec_id": 65, "role": "tank" },
            { "character_name": "Playerthree", "class_id": 5, "spec_id": 258, "role": "healer" }
          ]
        }
      ]
    },
    {
      "period_id": 1002,
      "keys_count": 1000,
      "keys": [...]
    }
  ]
}
```

### GET /meta/spec-evolution/:season_id
Returns specialization evolution data for a given season, showing how spec popularity changed over time.

**Path Parameters:**
- `season_id`: Season ID (required)

**Example Request:**
```
GET /meta/spec-evolution/14
```

**Response:**
```json
{
  "season_id": 14,
  "evolution": [
    {
      "period_id": 1001,
      "spec_counts": {
        "71": 150,   // Arms Warrior
        "65": 120,   // Protection Paladin
        "258": 100,  // Shadow Priest
        "259": 80,   // Assassination Rogue
        "260": 75    // Outlaw Rogue
      }
    },
    {
      "period_id": 1002,
      "spec_counts": {
        "71": 160,   // Arms Warrior (increased)
        "65": 110,   // Protection Paladin (decreased)
        "258": 105,  // Shadow Priest (increased)
        "259": 85,   // Assassination Rogue (increased)
        "260": 70    // Outlaw Rogue (decreased)
      }
    }
  ]
}
```

**Use Cases:**
- **Meta Analysis**: Track how specialization popularity evolves throughout a season
- **AI Training**: Provide comprehensive data for machine learning models
- **Trend Analysis**: Identify emerging meta trends and spec viability
- **Balance Insights**: Understand how class/spec balance changes over time

---

## 🔧 Admin Endpoints

*All admin endpoints require authentication*

### GET /admin/test
Test endpoint for admin authentication.

**Response:**
```json
{
  "success": true,
  "message": "Admin authentication successful",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### POST /admin/populate-dungeons
Populates the dungeon table with data from Blizzard's API.

**Response:**
```json
{
  "status": "OK",
  "inserted": 25,
  "failed": 0
}
```

### POST /admin/populate-seasons
Populates the season table with data from Blizzard's API.

**Response:**
```json
{
  "status": "OK",
  "inserted": 15,
  "failed": 0
}
```

### POST /admin/populate-periods
Populates the period table with data from Blizzard's API.

**Response:**
```json
{
  "status": "OK",
  "inserted": 120,
  "failed": 0
}
```

### POST /admin/populate-realms
Populates the realm table with data from all regions.

**Response:**
```json
{
  "status": "OK",
  "inserted": 450,
  "failed": 0,
  "regionErrors": 0
}
```

### POST /admin/import-all-leaderboard-json
Import all JSON files in `./output` into the database (batched, parallelized, progress bar in logs).

**Response:**
```json
{
  "status": "OK",
  "totalRuns": 150000,
  "totalMembers": 750000,
  "results": [
    {
      "filename": "us-s14-p1001-d247.json",
      "runs": 500,
      "members": 2500
    }
  ]
}
```

### POST /admin/import-all-leaderboard-json-fast
Optimized version for large datasets with improved performance.

**Response:**
```json
{
  "status": "OK",
  "totalRuns": 150000,
  "totalMembers": 750000,
  "results": [
    {
      "filename": "us-s14-p1001-d247.json",
      "runs": 500,
      "members": 2500
    }
  ]
}
```

### POST /admin/cleanup-leaderboard
Deletes all but the top 1000 runs per (dungeon_id, period_id, season_id) from the leaderboard_run table.

**Request Body:**
```json
{
  "season_id": 14
}
```
*Note: season_id is optional. If not provided, cleanup is performed for all seasons.*

**Response:**
```json
{
  "status": "OK",
  "rows_deleted": 12345,
  "duration_ms": 1500,
  "message": "Deleted 12345 rows in 1500ms"
}
```

### POST /admin/clear-output
Deletes all files in the `./output` directory. **Not allowed in production.**

**Response:**
```json
{
  "status": "OK",
  "deleted": ["file1.json", "file2.json"],
  "errors": []
}
```

### POST /admin/refresh-views
Refreshes all materialized views used for meta/leaderboard queries.

**Response:**
```json
{
  "status": "OK",
  "message": "All materialized views refreshed."
}
```

---

## 🗄️ Database Management Endpoints

### GET /admin/db/stats
Get database performance statistics.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "pool": {
    "totalCount": 10,
    "idleCount": 8,
    "waitingCount": 0
  },
  "server": {
    "version": "PostgreSQL 15.1",
    "max_connections": 100,
    "shared_buffers": "128MB",
    "work_mem": "4MB",
    "maintenance_work_mem": "64MB",
    "effective_cache_size": "4GB"
  },
  "connections": {
    "active_connections": 5,
    "active_queries": 2,
    "idle_connections": 3,
    "idle_in_transaction": 0
  },
  "table_sizes": [
    {
      "schemaname": "public",
      "tablename": "leaderboard_run",
      "size": "1.2 GB",
      "size_bytes": 1288490189
    }
  ],
  "index_stats": [
    {
      "schemaname": "public",
      "tablename": "leaderboard_run",
      "indexname": "idx_cleanup_leaderboard_runs",
      "index_scans": 15000,
      "tuples_read": 5000000,
      "tuples_fetched": 1000000
    }
  ],
  "slow_queries": [
    {
      "query": "SELECT * FROM leaderboard_run WHERE season_id = $1",
      "calls": 1000,
      "total_time": 5000,
      "mean_time": 5,
      "rows": 50000
    }
  ]
}
```

### GET /admin/db/performance-test
Run a performance test on the database.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "performance_tests": {
    "simple_count_query_ms": 15,
    "complex_group_query_ms": 45,
    "index_scan_query_ms": 8,
    "concurrent_queries_ms": 25
  }
}
```

### POST /admin/db/analyze
Run ANALYZE on all tables.

**Response:**
```json
{
  "status": "OK",
  "message": "ANALYZE completed successfully",
  "duration_ms": 5000
}
```

### POST /admin/vacuum-full
Perform VACUUM FULL on the database. This operation requires exclusive access, can take a very long time (potentially hours), and blocks all other database operations. Use with caution.

**Response:**
```json
{
  "status": "OK",
  "message": "VACUUM FULL completed successfully",
  "result": {
    "command": "VACUUM",
    "rowCount": null
  }
}
```

### POST /admin/vacuum-analyze
Perform VACUUM ANALYZE on the database. This operation updates statistics and reclaims some storage space. It's safer than VACUUM FULL as it doesn't require exclusive access and won't block other operations.

**Response:**
```json
{
  "status": "OK",
  "message": "VACUUM ANALYZE completed successfully",
  "result": {
    "command": "VACUUM",
    "rowCount": null
  }
}
```

---

## 🤖 Automation Endpoints

### POST /admin/automation/trigger
Trigger the full daily automation in the background.

**Response:**
```json
{
  "status": "OK",
  "message": "Automation started in background",
  "note": "Check logs for progress and completion status"
}
```

### POST /admin/automation/trigger-sync
Trigger automation synchronously (for testing).

**Response:**
```json
{
  "status": "OK",
  "result": {
    "status": "success",
    "message": "Automation completed successfully",
    "steps": [
      "Data fetching completed",
      "Import completed",
      "Cleanup completed",
      "Views refreshed"
    ]
  }
}
```

### GET /admin/automation/status
Check automation status.

**Response:**
```json
{
  "status": "OK",
  "message": "Automation system is ready",
  "endpoints": {
    "trigger": "POST /admin/automation/trigger - Start automation in background",
    "triggerSync": "POST /admin/automation/trigger-sync - Start automation synchronously",
    "status": "GET /admin/automation/status - Check this endpoint"
  }
}
```

### POST /admin/automation/fetch-data
Trigger only the data fetching step.

**Response:**
```json
{
  "status": "OK",
  "result": {
    "status": "success",
    "filesGenerated": 120,
    "message": "Data fetching completed"
  }
}
```

### POST /admin/automation/import-data
Trigger only the import step.

**Response:**
```json
{
  "status": "OK",
  "result": {
    "status": "success",
    "totalRuns": 150000,
    "totalMembers": 750000,
    "message": "Import completed"
  }
}
```

### POST /admin/automation/cleanup
Trigger only the cleanup step.

**Request Body:**
```json
{
  "season_id": 14
}
```

**Response:**
```json
{
  "status": "OK",
  "result": {
    "status": "success",
    "rows_deleted": 12345,
    "message": "Cleanup completed"
  }
}
```

### POST /admin/automation/refresh-views
Trigger only the refresh views step.

**Response:**
```json
{
  "status": "OK",
  "result": {
    "status": "success",
    "message": "Views refreshed successfully"
  }
}
```

---

## ⚠️ Error Handling

### Standard HTTP Status Codes
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Rate Limited
- `500` - Internal Server Error

### Error Response Format
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

## 🚦 Rate Limiting

- **Limit**: 100 requests per 15 minutes per IP
- **Headers**:
  - `X-RateLimit-Limit`: Maximum requests allowed
  - `X-RateLimit-Remaining`: Requests remaining in current window
  - `X-RateLimit-Reset`: Time when the rate limit resets (Unix timestamp)

---

## 🔧 Environment Variables

Set these in your `.env` file:

```env
# Blizzard API Credentials
BLIZZARD_CLIENT_ID=your_client_id_here
BLIZZARD_CLIENT_SECRET=your_client_secret_here

# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
PGHOST=localhost
PGPORT=5432
PGUSER=wowuser
PGPASSWORD=yourpassword
PGDATABASE=wow_leaderboard

# Admin Authentication
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure_password
```

---

## 📚 Import/ETL Workflow

### Complete Data Pipeline

1. **Generate Data Files**:
   ```
   GET /wow/advanced/mythic-leaderboard/:seasonId/
   GET /wow/advanced/mythic-leaderboard/:seasonId/:periodId
   ```

2. **Import into Database**:
   ```
   POST /admin/import-all-leaderboard-json
   POST /admin/import-all-leaderboard-json-fast
   ```

3. **Cleanup (Optional)**:
   ```
   POST /admin/cleanup-leaderboard
   ```

4. **Refresh Views**:
   ```
   POST /admin/refresh-views
   ```

5. **Query Data**:
   ```
   GET /meta/top-keys?season_id=14
   ```

---

## 🔒 Security

- **Helmet.js**: Security headers
- **CORS**: Enabled for cross-origin requests
- **Input Validation**: All parameters validated
- **Admin Authentication**: Protected admin endpoints
- **Rate Limiting**: Prevents abuse

---

## 📖 Database Structure

- **Main Tables**: `leaderboard_run`, `run_group_member`, `dungeon`, `period`, `realm`, `season`
- **Materialized Views**: `top_keys_per_group`, `top_keys_global`, `top_keys_per_period`, `top_keys_per_dungeon`
- **Optimized Indexes**: Strategic indexing for fast queries
- **See**: `utils/DB_README.md` for detailed database documentation

---

## 🆘 Support

For issues or questions:
1. Check the project README
2. Review database documentation in `utils/DB_README.md`
3. Create an issue in the repository
4. Check server logs for detailed error information 