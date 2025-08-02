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
const { populateDungeons, populateSeasons, populatePeriods, populateRealms } = require('./routes/admin');
const metaRoutes = require('./routes/meta');
const aiRoutes = require('./routes/ai');
const { pool } = require('./services/db'); // <-- Import the pool

const app = express();
const PORT = process.env.PORT || 3000;

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

    console.log('Populating dungeons...');
    const dungeonsResult = await populateDungeons();
    console.log('Dungeons:', dungeonsResult);
    console.log('Populating seasons...');
    const seasonsResult = await populateSeasons();
    console.log('Seasons:', seasonsResult);
    console.log('Populating periods...');
    const periodsResult = await populatePeriods();
    console.log('Periods:', periodsResult);
    console.log('Populating realms...');
    const realmsResult = await populateRealms();
    console.log('Realms:', realmsResult);
    app.listen(PORT, () => {
      console.log(`🚀 WoW API Proxy server running on port ${PORT}`);
      console.log(`❤️ Healthcheck: http://localhost:${PORT}/health`);
      console.log(`📚 Connected to DB: ${process.env.PGHOST}/${process.env.PGDATABASE}`);
      console.log(`** SERVICE IS READY **`);
    });
  } catch (err) {
    console.error('❌ Failed to connect to DB or populate data:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app;