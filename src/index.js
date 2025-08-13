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

async function startServer() {
  try {
    // Test DB connection before starting
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL DB');
    console.log(`📚 Database: ${process.env.PGDATABASE} on ${process.env.PGHOST}`);

    // Single switch: populate all or nothing
    const isProd = (process.env.NODE_ENV || 'development') === 'production';
    const shouldPopulate = parseEnvFlag(process.env.POPULATE_ON_START, !isProd);

    if (shouldPopulate) {
      console.log('🔄 Populating data on start (all-or-nothing)...');
      const [dungeonsResult, seasonsResult, periodsResult, realmsResult, raiderioStaticResult] = await Promise.allSettled([
        populateDungeons(),
        populateSeasons(),
        populatePeriods(),
        populateRealms(),
        // Call directly instead of HTTP fetch to avoid startup dependency on network stack
        syncRaiderioStatic('all'),
      ]);

      // Log results with status
      console.log('📊 Population Results (all-or-nothing):');
      console.log('Dungeons:', dungeonsResult.status === 'fulfilled' ? dungeonsResult.value : `ERROR: ${dungeonsResult.reason}`);
      console.log('Seasons:', seasonsResult.status === 'fulfilled' ? seasonsResult.value : `ERROR: ${seasonsResult.reason}`);
      console.log('Periods:', periodsResult.status === 'fulfilled' ? periodsResult.value : `ERROR: ${periodsResult.reason}`);
      console.log('Realms:', realmsResult.status === 'fulfilled' ? realmsResult.value : `ERROR: ${realmsResult.reason}`);
      console.log('Raider.IO Static:', raiderioStaticResult.status === 'fulfilled' ? raiderioStaticResult.value : `ERROR: ${raiderioStaticResult.reason}`);

      // Check if any population failed
      const failedPopulations = [dungeonsResult, seasonsResult, periodsResult, realmsResult, raiderioStaticResult]
        .filter(result => result.status === 'rejected');
      
      if (failedPopulations.length > 0) {
        console.warn(`⚠️ ${failedPopulations.length} population(s) failed, continuing with server startup...`);
      }

      console.log('🔁 Starting background season→dungeon backfill...');
      backfillSeasonDungeonMappings(PORT);
    } else {
      console.log('⏭️ Skipping DB population on start (POPULATE_ON_START disabled)');
    }

    app.listen(PORT, () => {
      console.log(`🚀 WoW API Proxy server running on port ${PORT}`);
      console.log(`❤️ Healthcheck: http://localhost:${PORT}/health`);
      console.log(`📚 Connected to DB: ${process.env.PGHOST}/${process.env.PGDATABASE}`);
      console.log(``);
      console.log(`** SERVICE IS READY **`);
      console.log(``);
    });
  } catch (err) {
    console.error('❌ Failed to connect to DB or populate data:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;