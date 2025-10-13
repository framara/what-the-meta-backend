# Copilot Instructions - What the Meta Backend

## Project Overview
Node.js/Express API backend for the What the Meta WoW Mythic+ leaderboard platform. Aggregates data from Blizzard & RaiderIO APIs, stores in PostgreSQL, and provides REST endpoints for frontend consumption.

**Live API**: https://what-the-meta-backend.onrender.com | **Deployed on**: Render.com (Web Service + Managed PostgreSQL)

## Architecture

### Data Pipeline
1. **Automated jobs** (`scripts/job-*.js`) run every 4 hours collecting Blizzard/RaiderIO data → save as JSON in `output/`
2. **Data import** (`POST /admin/import-all-leaderboard-json`) processes JSON files → PostgreSQL via bulk `COPY` operations
3. **Materialized views** (`mv_spec_evolution`, `mv_top_keys_global`) pre-compute expensive aggregations for fast queries
4. **API endpoints** (`/meta/*`, `/ai/*`) serve optimized data with 1-hour CDN caching
5. **AI analysis** uses OpenAI GPT-4 with 24-hour database caching to predict meta trends

### Database Schema
- **Core tables**: `leaderboard_run` (runs), `run_group_member` (compositions), `dungeon`, `period`, `season`, `realm`
- **Unique constraint**: `(dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level)` prevents duplicates
- **Foreign keys**: Cascade deletes on seasons, restrict on dungeons/realms
- **Materialized views**: Refresh with `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_spec_evolution;`
- **Future**: LIST partitioning by `season_id` planned (see `DB_PARTITIONING.md`)

## Critical Developer Workflows

### Local Development Setup
```bash
# Start PostgreSQL via Docker (requires 8GB RAM, 4 CPUs)
docker-compose up -d

# Wait for health check, then initialize schema
psql -h localhost -U wowuser -d wow_leaderboard -f utils/db_structure.sql

# Start dev server with auto-reload
npm run dev  # Runs on http://localhost:3000
```

### Running Data Collection Jobs
```bash
# Test job execution locally (requires valid ADMIN_API_KEY and BLIZZARD credentials)
npm run daily-job    # Collects current period data for all regions
npm run weekly-job   # Processes previous period data
npm run rio-latest-job  # Fetches RaiderIO cutoffs and static data

# Production: Jobs run as Render Cron Jobs (configured in Render dashboard)
```

### Database Operations
```bash
# Refresh materialized views after bulk imports (required!)
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_spec_evolution;"

# Maintenance (vacuum, analyze, reindex)
psql -h $PGHOST -U $PGUSER -d $PGDATABASE -f utils/database_maintenance.sql

# Manual backup
pg_dump -h $PGHOST -U $PGUSER -d $PGDATABASE > backups/backup_$(date +%Y%m%d_%H%M%S).sql
```

## Project-Specific Conventions

### Admin Authentication
- **All admin routes** require `X-Admin-API-Key` header (see `middleware/admin-auth.js`)
- **Generate key**: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **Set in Render**: Add to Environment Variables tab in dashboard

### Error Handling Pattern
```javascript
// Use error-handler.js middleware - NEVER expose stack traces in production
app.use(errorHandler);

// In routes:
try {
  const result = await someOperation();
  res.json(result);
} catch (err) {
  // errorHandler middleware automatically handles it
  next(err);
}
```

### Rate Limiting
- **Dev**: Disabled (`NODE_ENV=development`)
- **Prod**: 500 requests per 15 minutes (`middleware/rate-limit.js`)
- **Test**: Set `RATE_LIMIT_MAX_REQUESTS=5` to trigger 429 responses

### Cache Headers for Render Edge CDN
```javascript
// Meta and AI endpoints use 1-hour caching
res.set('Cache-Control', 'public, max-age=3600');
res.json(data);
```

### Job Locking Pattern
```javascript
// All automation scripts use database locks to prevent concurrent runs
const HAS_LOCK = await acquireJobLock('job-name', 7200); // 2 hour TTL
if (!HAS_LOCK) {
  console.log('Another job is running, exiting...');
  process.exit(0);
}
try {
  // ... do work
} finally {
  await releaseJobLock('job-name');
}
```

### Database Upsert Pattern
```javascript
// Use ON CONFLICT for idempotent inserts (see services/db.js)
const query = `
  INSERT INTO leaderboard_run (dungeon_id, period_id, ...)
  VALUES ($1, $2, ...)
  ON CONFLICT (dungeon_id, period_id, season_id, region, completed_at, duration_ms, keystone_level)
  DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank;
`;
```

## Environment Variables

### Required
```bash
# Blizzard API (OAuth)
BLIZZARD_CLIENT_ID=your_client_id
BLIZZARD_CLIENT_SECRET=your_client_secret

# Admin API
ADMIN_API_KEY=<generate with crypto.randomBytes(32).toString('hex')>

# PostgreSQL
PGHOST=dpg-xxx.frankfurt-postgres.render.com
PGPORT=5432
PGUSER=wtm_leaderboard_user
PGPASSWORD=<from Render dashboard>
PGDATABASE=wtm_leaderboard
PGSSLMODE=require  # Required for Render

# Server
NODE_ENV=production
PORT=3000
TRUST_PROXY=1  # Required for rate limiting behind Render proxy
```

### Optional
```bash
# OpenAI (for AI predictions)
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini  # Options: gpt-4o, gpt-4o-mini, gpt-4-turbo

# RaiderIO tuning
RAIDERIO_MAX_RPS=12  # Requests per second (default 10)
RAIDERIO_TIMEOUT_MS=12000
RAIDERIO_RETRY_MAX=3

# Database pool tuning
PG_POOL_MAX=20  # Max connections (Render free tier: 95 total)
PG_POOL_MIN=4
PG_IDLE_TIMEOUT_MS=30000

# CORS
FRONTEND_URL=https://www.whatthemeta.io
ALLOWED_ORIGINS=https://www.whatthemeta.io,http://localhost:5173
```

## Deployment

### Render.com Setup
1. **Git push** to `develop` branch → auto-deploy to staging
2. **PR merge** to `release` branch → auto-deploy to production
3. **Environment variables**: Set in Render dashboard (Services → Environment)
4. **Cron jobs**: Configure in Render dashboard (Cron Jobs → Add Job)
   - Daily: `npm run daily-job` (every 4 hours: `0 */4 * * *`)
   - Weekly: `npm run weekly-job` (Sundays at 2 AM: `0 2 * * 0`)
   - RaiderIO: `npm run rio-latest-job` (every 6 hours: `0 */6 * * *`)

### Season Transitions
- **Automated**: Jobs detect new seasons and start collecting data
- **Manual steps**:
  1. Populate new season metadata: `POST /admin/populate-seasons` with `X-Admin-API-Key`
  2. Populate dungeons: `POST /admin/populate-dungeons`
  3. Populate periods: `POST /admin/populate-periods`
  4. Monitor first job run for new season data collection
  5. Refresh materialized views after sufficient data: `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_spec_evolution;`

## External API Integration

### Blizzard Game Data API
- **OAuth flow**: `services/blizzard/auth.js` handles token fetch and auto-refresh
- **Proxy pattern**: All frontend calls go through `/wow/game-data/*` → backend adds auth token
- **Regional routing**: Backend routes to correct regional endpoint (us.api, eu.api, etc.)

### RaiderIO API
- **Rate limiting**: Configurable via `RAIDERIO_MAX_RPS` (default 12 req/sec)
- **Retry logic**: Exponential backoff for 429/5xx errors (see `services/raiderio/client.js`)
- **Cutoffs**: `/raiderio/cutoffs/:region` returns current Mythic+ rating thresholds

### OpenAI GPT-4
- **AI predictions**: `POST /ai/predictions` analyzes season data for meta trends
- **Caching**: 24-hour cache in `ai_analysis_cache` table (bypass with `?force=true`)
- **Fallback**: Statistical analysis if OpenAI API fails or key missing

## Common Gotchas

1. **Materialized views**: Must manually refresh after bulk imports or data becomes stale
2. **Connection pool**: Render free tier = 95 max connections. Default pool size 20, leaves headroom for admin tools
3. **Job locking**: Always check `HAS_LOCK` before proceeding in automation scripts
4. **Docker pgdata**: Directory contains live data—do NOT delete or reinit without backup
5. **Admin endpoints**: Return 401 if `ADMIN_API_KEY` not set or mismatched
6. **CORS errors**: Ensure `ALLOWED_ORIGINS` includes frontend domain

## Testing & Debugging

- **Health check**: `GET /health` returns DB connection status and environment
- **DB performance**: `EXPLAIN ANALYZE <query>` to debug slow queries
- **AI cache inspection**: `SELECT * FROM ai_analysis_cache WHERE season_id = 14;`
- **Job debugging**: Check Render logs for `[DAILY]`, `[WEEKLY]`, `[RIO]` prefixes
- **No automated tests**: Jest configured in `package.json` but no test suite (to-do)

## Key Files

- **`src/index.js`**: Express app setup, middleware order, route mounting
- **`src/services/db.js`**: PostgreSQL pool config, upsert functions
- **`src/middleware/admin-auth.js`**: Admin API key validation
- **`src/routes/ai.js`**: OpenAI integration with caching
- **`scripts/job-daily-current-period.js`**: Main automation script pattern (representative)
- **`utils/db_structure.sql`**: Complete database schema
- **`utils/database_maintenance.sql`**: Vacuum, analyze, reindex operations
- **`env.example`**: Environment variable template

## Documentation
- `README.md`: API endpoints, data sources, production architecture
- `AI_INTEGRATION.md`: OpenAI GPT-4 integration details
- `DB_PARTITIONING.md`: Future partitioning strategy (not yet implemented)
- `SECURITY.md`: Security checklist, best practices

---

**When suggesting changes**: Preserve job locking mechanisms, maintain materialized view refresh workflows, and never expose sensitive data in error responses. Always validate environment variables before using them.
