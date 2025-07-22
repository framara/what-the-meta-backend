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

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors());

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(rateLimit);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'WoW API Proxy'
  });
});

// API routes
app.use('/battle-net', battleNetRoutes);
app.use('/wow', wowRoutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

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
      console.log(`📚 Healthcheck: http://localhost:${PORT}/health`);
      console.log(`------------------------------------------------`);
      console.log(`             SERVICE IS READY`);
      console.log(`------------------------------------------------`);
    });
  } catch (err) {
    console.error('Failed to populate DB:', err);
    process.exit(1);
  }
}

startServer();

module.exports = app; 