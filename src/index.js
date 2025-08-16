const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const battleNetRoutes = require('./routes/battle-net');
const wowRoutes = require('./routes/wow');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const errorHandler = require('./middleware/error-handler');
const rateLimit = require('./middleware/rate-limit');
const { populateDungeons, populateSeasons, populatePeriods, populateRealms, syncRaiderioStatic } = require('./routes/admin');
const adminRouter = require('./routes/admin');
const metaRoutes = require('./routes/meta');
const aiRoutes = require('./routes/ai');
const raiderIORoutes = require('./routes/raiderio');
const { pool } = require('./services/db'); // <-- Import the pool
const { backfillSeasonDungeonMappings } = require('./services/seasonBackfill');

const app = express();
const PORT = process.env.PORT || 3000;

// Helper to parse boolean-like env flags
function parseEnvFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

// Security middleware
app.use(helmet());

// Trust reverse proxy so req.ip, rate limiting, and secure cookies work behind Render/NGINX
// Default: trust 1 hop in production, disabled in development unless overridden by env
function parseTrustProxy(value) {
  if (value === undefined || value === null || value === '') {
    return (process.env.NODE_ENV || 'development') === 'production' ? 1 : false;
  }
  const v = String(value).trim();
  const lower = v.toLowerCase();
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  if (['true', 'yes', 'on'].includes(lower)) return true;
  if (['false', 'no', 'off'].includes(lower)) return false;
  return v; // e.g., 'loopback', '127.0.0.1'
}
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// CORS configuration with specific origins
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL, process.env.ALLOWED_ORIGINS?.split(',')].flat().filter(Boolean)
    : true, // Allow all origins in development
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsing middleware with increased limits for AI analysis
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting (disabled in development)
if (process.env.NODE_ENV !== 'development') {
  app.use(rateLimit);
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      service: 'WoW API Proxy',
      dbConnection: 'connected',
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (err) {
    res.status(500).json({
      status: 'ERROR',
      message: 'Database connection failed',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
      dbConnection: 'failed',
      environment: process.env.NODE_ENV || 'development'
    });
  }
});

// API routes
app.use('/battle-net', battleNetRoutes);
app.use('/wow', wowRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/meta', metaRoutes);
app.use('/ai', aiRoutes);
app.use('/raiderio', raiderIORoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.originalUrl} does not exist`
  });
});

// Error handling middleware
app.use(errorHandler);

// Background DB readiness monitor with retry/backoff
async function waitForDbReady(maxWaitMs = 10 * 60 * 1000) { // 10 minutes cap
  const start = Date.now();
  let delay = 1000; // 1s initial
  while (true) {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      const code = err?.code;
      const msg = err?.message || '';
      const elapsed = Date.now() - start;
      // Known transient states: DB not accepting connections yet, or connection reset
      const transient = code === '57P03' || /not.*accepting.*connections/i.test(msg) || /terminated unexpectedly/i.test(msg) || /ECONNREFUSED|ECONNRESET|ETIMEDOUT/.test(msg);
      if (!transient) {
        console.warn('[DB] Non-transient error during readiness check:', code, msg);
      }
      if (elapsed >= maxWaitMs) {
        console.warn(`[DB] Readiness wait exceeded ${(maxWaitMs/1000)|0}s. Continuing without DB ready.`);
        return false;
      }
      await new Promise(r => setTimeout(r, delay));
      delay = Math.min(Math.floor(delay * 1.5), 15000); // cap at 15s
    }
  }
}

async function initAfterDbReady() {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  const shouldPopulate = parseEnvFlag(process.env.POPULATE_ON_START, !isProd);

  const ready = await waitForDbReady();
  if (ready) {
    console.log('✅ Connected to PostgreSQL DB');
    console.log(`📚 Database: ${process.env.PGDATABASE} on ${process.env.PGHOST}`);

    if (shouldPopulate) {
      try {
        console.log('🔄 Populating data on start...');
        const [dungeonsResult, seasonsResult, periodsResult, realmsResult, raiderioStaticResult] = await Promise.allSettled([
          populateDungeons(),
          populateSeasons(),
          populatePeriods(),
          populateRealms(),
          syncRaiderioStatic('all'),
        ]);

        console.log('📊 Population Results:');
        console.log('Dungeons:', dungeonsResult.status === 'fulfilled' ? dungeonsResult.value : `ERROR: ${dungeonsResult.reason}`);
        console.log('Seasons:', seasonsResult.status === 'fulfilled' ? seasonsResult.value : `ERROR: ${seasonsResult.reason}`);
        console.log('Periods:', periodsResult.status === 'fulfilled' ? periodsResult.value : `ERROR: ${periodsResult.reason}`);
        console.log('Realms:', realmsResult.status === 'fulfilled' ? realmsResult.value : `ERROR: ${realmsResult.reason}`);
        console.log('Raider.IO Static:', raiderioStaticResult.status === 'fulfilled' ? raiderioStaticResult.value : `ERROR: ${raiderioStaticResult.reason}`);

        const failedPopulations = [dungeonsResult, seasonsResult, periodsResult, realmsResult, raiderioStaticResult]
          .filter(result => result.status === 'rejected');
        if (failedPopulations.length > 0) {
          console.warn(`⚠️ ${failedPopulations.length} population(s) failed, continuing...`);
        }
      } catch (e) {
        console.warn('⚠️ Population step failed:', e?.message || e);
      }

      try {
        console.log('🔁 Starting background season→dungeon backfill...');
        backfillSeasonDungeonMappings(PORT);
      } catch (e) {
        console.warn('⚠️ Failed to start background backfill:', e?.message || e);
      }

    } else {
      console.log('⏭️ Skipping DB population on start (POPULATE_ON_START disabled)');
    }
  } else {
    // Not ready in time: keep probing in background until success, then run backfill once
    console.warn('[DB] Not ready after initial wait. Will keep probing every 10s in background.');
    const timer = setInterval(async () => {
      try {
        await pool.query('SELECT 1');
        clearInterval(timer);
        console.log('✅ DB became ready later. Starting background backfill...');
        try { backfillSeasonDungeonMappings(PORT); } catch (_) {}
      } catch (_) {
        // keep waiting
      }
    }, 10000);
  }
}

// Start HTTP server immediately to avoid platform healthcheck timeouts
app.listen(PORT, () => {
  console.log(`🚀 WoW API Proxy server running on port ${PORT}`);
  console.log(`❤️ Healthcheck: http://localhost:${PORT}/health`);
  console.log(`📚 Target DB: ${process.env.PGHOST}/${process.env.PGDATABASE}`);
  console.log(``);
  console.log(`** SERVICE IS STARTING **`);
  console.log(``);
});

// Initialize DB-dependent tasks in the background
initAfterDbReady();

// Guard against crash loops on transient PG errors
process.on('unhandledRejection', (reason) => {
  const msg = (reason && reason.message) || String(reason);
  if (/terminated unexpectedly|ECONNRESET|ECONNREFUSED|ETIMEDOUT/.test(msg)) {
    console.warn('[unhandledRejection]', msg);
  } else {
    console.error('[unhandledRejection]', reason);
  }
});
process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (/terminated unexpectedly|ECONNRESET|ECONNREFUSED|ETIMEDOUT/.test(msg)) {
    console.warn('[uncaughtException]', msg);
  } else {
    console.error('[uncaughtException]', err);
  }
});

module.exports = app;