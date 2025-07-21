const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const battleNetRoutes = require('./routes/battle-net');
const wowRoutes = require('./routes/wow');
const authRoutes = require('./routes/auth');
const errorHandler = require('./middleware/error-handler');
const rateLimit = require('./middleware/rate-limit');

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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    message: `The endpoint ${req.originalUrl} does not exist`
  });
});

// Error handling middleware
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 WoW API Proxy server running on port ${PORT}`);
  console.log(`📚 API Documentation: http://localhost:${PORT}/health`);
});

module.exports = app; 